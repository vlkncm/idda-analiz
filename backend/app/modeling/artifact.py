from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.modeling.calibration import ProbabilityCalibrator
from app.modeling.ensemble import EnsembleModel
from app.modeling.ml import MLProbabilityModels
from app.modeling.elo import EloThreeWayCalibrator


@dataclass(slots=True)
class PredictionArtifact:
    version: str
    league_code: str
    feature_columns: list[str]
    ml: MLProbabilityModels
    result_calibrator: ProbabilityCalibrator
    over_calibrator: ProbabilityCalibrator
    result_weights: tuple[float, ...]
    elo_calibrator: EloThreeWayCalibrator | None = None
    over_weights: tuple[float, float, float] = (0.55, 0.35, 0.10)
    calibration_error: float = 0.05

    def predict(self, features: dict[str, float], dixon_coles: tuple[float, float, float, float], elo: tuple[float, float, float] | None = None) -> dict:
        missing = [name for name in self.feature_columns if name not in features]
        if missing:
            raise ValueError(f"missing model features: {', '.join(missing)}")
        frame = pd.DataFrame([[features[name] for name in self.feature_columns]], columns=self.feature_columns)
        raw_result, raw_over = self.ml.predict(frame)
        calibrated_result = self.result_calibrator.transform(raw_result)[0]
        calibrated_over = float(self.over_calibrator.transform(raw_over)[0])
        if elo is None:
            if self.elo_calibrator is None:
                raise RuntimeError("artifact has no calibrated Elo model")
            elo_prediction = self.elo_calibrator.predict(self.league_code, features["elo_difference"])
            elo = (elo_prediction.home, elo_prediction.draw, elo_prediction.away)
        market = None if features.get("market_data_missing", 1.0) else (features["market_home_probability"], features["market_draw_probability"], features["market_away_probability"])
        ensemble = EnsembleModel(self.result_weights).predict_one(calibrated_result, dixon_coles[:3], elo, self._completeness(features), max(0.0, 1.0 - self.calibration_error), market)
        over_components, over_weights = [calibrated_over, dixon_coles[3]], list(self.over_weights[:2])
        if market is not None and features.get("market_over25_probability", 0) > 0:
            over_components.append(features["market_over25_probability"])
            over_weights.append(self.over_weights[2])
        over25 = float(np.average(over_components, weights=over_weights))
        components = {"ml": tuple(map(float, calibrated_result)), "dixon_coles": tuple(map(float, dixon_coles[:3])), "elo": tuple(map(float, elo))}
        if market is not None:
            components["market"] = tuple(map(float, market))
        return {"home": ensemble.probabilities[0], "draw": ensemble.probabilities[1], "away": ensemble.probabilities[2], "over25": over25, "confidence_score": ensemble.confidence_score, "confidence": ensemble.confidence, "agreement": ensemble.agreement, "component_probabilities": components}

    @staticmethod
    def _completeness(features: dict[str, float]) -> float:
        flags = [value for key, value in features.items() if key.endswith("_missing")]
        return 1.0 - sum(flags) / len(flags) if flags else 1.0

    def save(self, artifact_root: str | Path) -> Path:
        root = Path(artifact_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"{self.league_code}-{self.version}.joblib"
        joblib.dump(self, path)
        return path

    @staticmethod
    def load(path: str | Path) -> "PredictionArtifact":
        return joblib.load(Path(path))


def fit_artifact(version: str, league_code: str, train, validation, feature_columns: list[str]) -> PredictionArtifact:
    """Fit a deployable artifact without allowing validation/test leakage into ML fitting."""
    ml = MLProbabilityModels().fit(train[feature_columns], train["result_target"], train["over25_target"], train.get("sample_weight"))
    validation_result, validation_over = ml.predict(validation[feature_columns])
    result_calibrator = ProbabilityCalibrator().fit(validation_result, validation["result_target"].to_numpy())
    over_calibrator = ProbabilityCalibrator().fit(validation_over, validation["over25_target"].to_numpy())
    calibrated_result = result_calibrator.transform(validation_result)
    dc = validation[["dc_home", "dc_draw", "dc_away"]].to_numpy()
    elo_calibrator = EloThreeWayCalibrator().fit(league_code, train["elo_difference"], train["result_target"])
    elo_rows = [elo_calibrator.predict(league_code, value) for value in validation["elo_difference"]]
    elo = np.asarray([(row.home, row.draw, row.away) for row in elo_rows])
    market_columns = ["market_home_probability", "market_draw_probability", "market_away_probability"]
    if all(column in validation for column in market_columns):
        market = validation[market_columns].to_numpy(copy=True)
        missing_market = validation.get("market_data_missing", pd.Series(False, index=validation.index)).to_numpy().astype(bool)
        market[missing_market] = dc[missing_market]
    else:
        market = dc.copy()
    ensemble = EnsembleModel()
    weights = ensemble.optimize([calibrated_result, dc, elo, market], validation["result_target"].to_numpy())
    return PredictionArtifact(version, league_code, feature_columns, ml, result_calibrator, over_calibrator, tuple(map(float, weights)), elo_calibrator)
