from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.backtesting.metrics import binary_metrics, multiclass_metrics
from app.backtesting.walk_forward import WalkForwardSplit
from app.modeling.calibration import ProbabilityCalibrator
from app.modeling.ensemble import EnsembleModel
from app.modeling.ml import MLProbabilityModels
from app.modeling.elo import EloThreeWayCalibrator


@dataclass(slots=True)
class FoldReport:
    train_seasons: tuple[str, ...]
    validation_season: str
    test_season: str
    weights: tuple[float, ...]
    result_metrics: dict
    over25_metrics: dict
    baseline_metrics: dict
    raw_ml_metrics: dict
    calibrated_ml_metrics: dict
    raw_over25_metrics: dict
    ml_beats_baseline: bool
    model_comparison: dict


class WalkForwardTrainer:
    """Fits every transform on train/validation only and evaluates once on the future fold."""

    MODEL_COLUMNS = ["dc_home", "dc_draw", "dc_away", "elo_home", "elo_draw", "elo_away"]

    def __init__(self, half_life_days: float = 365.0, minimum_train_seasons: int = 3, initial_weights: tuple[float, ...] = (0.40, 0.30, 0.20, 0.10)):
        self.half_life_days = half_life_days
        self.splitter = WalkForwardSplit(minimum_train_seasons)
        self.initial_weights = initial_weights

    def run(self, frame, result_target: str = "result_target", over_target: str = "over25_target", season_column: str = "season", date_column: str = "kickoff_at") -> list[FoldReport]:
        ordered = frame.sort_values(date_column).reset_index(drop=True)
        feature_columns = [column for column in ordered.columns if column not in {result_target, over_target, season_column, date_column, *self.MODEL_COLUMNS}]
        reports = []
        for fold in self.splitter.split(ordered[season_column]):
            train, validation, test = ordered.iloc[fold.train], ordered.iloc[fold.validation], ordered.iloc[fold.test]
            newest = train[date_column].max()
            age = (newest - train[date_column]).dt.total_seconds() / 86400
            sample_weight = np.exp(-np.log(2) * age / self.half_life_days)
            model = MLProbabilityModels().fit(train[feature_columns], train[result_target], train[over_target], sample_weight)
            baseline = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
            baseline.fit(train[feature_columns], train[result_target], logisticregression__sample_weight=sample_weight)
            baseline_test = baseline.predict_proba(test[feature_columns])
            val_ml, val_over = model.predict(validation[feature_columns])
            result_calibrator = ProbabilityCalibrator().fit(val_ml, validation[result_target].to_numpy())
            over_calibrator = ProbabilityCalibrator().fit(val_over, validation[over_target].to_numpy())
            calibrated_val = result_calibrator.transform(val_ml)
            elo_calibrator = EloThreeWayCalibrator().fit("fold", train["elo_difference"], train[result_target])
            val_elo_rows = [elo_calibrator.predict("fold", value) for value in validation["elo_difference"]]
            val_elo = np.asarray([(row.home, row.draw, row.away) for row in val_elo_rows])
            val_dc = validation[["dc_home", "dc_draw", "dc_away"]].to_numpy()
            market_columns = ["market_home_probability", "market_draw_probability", "market_away_probability"]
            val_market = validation[market_columns].to_numpy(copy=True) if all(c in validation for c in market_columns) else val_dc.copy()
            if "market_data_missing" in validation:
                val_market[validation["market_data_missing"].to_numpy().astype(bool)] = val_dc[validation["market_data_missing"].to_numpy().astype(bool)]
            val_models = [calibrated_val, val_dc, val_elo, val_market]
            ensemble = EnsembleModel(self.initial_weights)
            weights = ensemble.optimize(val_models, validation[result_target].to_numpy())
            test_ml, test_over = model.predict(test[feature_columns])
            calibrated_test = result_calibrator.transform(test_ml)
            calibrated_over = over_calibrator.transform(test_over)
            test_elo_rows = [elo_calibrator.predict("fold", value) for value in test["elo_difference"]]
            test_elo = np.asarray([(row.home, row.draw, row.away) for row in test_elo_rows])
            test_dc = test[["dc_home", "dc_draw", "dc_away"]].to_numpy()
            test_market = test[market_columns].to_numpy(copy=True) if all(c in test for c in market_columns) else test_dc.copy()
            if "market_data_missing" in test:
                test_market[test["market_data_missing"].to_numpy().astype(bool)] = test_dc[test["market_data_missing"].to_numpy().astype(bool)]
            test_models = [calibrated_test, test_dc, test_elo, test_market]
            combined = sum(weight * values for weight, values in zip(weights, test_models))
            baseline_metrics = multiclass_metrics(test[result_target], baseline_test)
            raw_ml_metrics = multiclass_metrics(test[result_target], test_ml)
            calibrated_ml_metrics = multiclass_metrics(test[result_target], calibrated_test)
            comparison = {name: multiclass_metrics(test[result_target], values) for name, values in zip(("ml", "dixon_coles", "elo", "market"), test_models)}
            comparison["ensemble"] = multiclass_metrics(test[result_target], combined)
            reports.append(FoldReport(tuple(sorted(set(map(str, train[season_column])))), str(validation[season_column].iloc[0]), str(test[season_column].iloc[0]), tuple(map(float, weights)), comparison["ensemble"], binary_metrics(test[over_target], calibrated_over), baseline_metrics, raw_ml_metrics, calibrated_ml_metrics, binary_metrics(test[over_target], test_over), calibrated_ml_metrics["log_loss"] < baseline_metrics["log_loss"], comparison))
        return reports
