from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.backtesting.metrics import multiclass_metrics
from app.modeling.artifact import fit_artifact
from app.modeling.training import WalkForwardTrainer
from app.models.football import League
from app.models.operational import BacktestRun, ModelMetric
from app.models.prediction import ModelVersion
from app.monitoring.promotion import evaluate_promotion
from app.services.dataset import TrainingDatasetBuilder


class TrainingService:
    def __init__(self, session: Session, artifact_dir: str, half_life_days: float = 180.0):
        self.db, self.artifact_dir, self.half_life_days = session, artifact_dir, half_life_days

    def train(self, version_name: str) -> dict:
        existing = self.db.scalar(select(ModelVersion).where(ModelVersion.version == version_name))
        if existing:
            raise ValueError(f"model version already exists: {version_name}")
        version = ModelVersion(version=version_name, description="Sportmonks chronological training", is_production=False, training_start=datetime.now(timezone.utc))
        self.db.add(version)
        self.db.flush()
        league_reports = {}
        shared_features: set[str] = set()
        for league in self.db.scalars(select(League).where(League.is_active.is_(True))).all():
            frame = TrainingDatasetBuilder(self.db, self.half_life_days).build(league)
            seasons = sorted(frame["season"].astype(str).unique()) if not frame.empty else []
            if len(frame) < 60 or len(seasons) < 2:
                league_reports[league.code] = {"status": "insufficient_data", "matches": len(frame), "seasons": len(seasons)}
                continue
            frame["season"] = frame["season"].astype(str)
            validation = frame[frame["season"] == seasons[-1]]
            train = frame[frame["season"] != seasons[-1]]
            excluded = {"season", "kickoff_at", "result_target", "over25_target", "dc_home", "dc_draw", "dc_away", "dc_over25", "elo_home", "elo_draw", "elo_away"}
            features = [column for column in frame.columns if column not in excluded and frame[column].dtype.kind in "biufc"]
            shared_features.update(features)
            artifact = fit_artifact(version_name, league.code, train, validation, features)
            artifact.save(self.artifact_dir)
            reports = WalkForwardTrainer(self.half_life_days, minimum_train_seasons=min(3, max(1, len(seasons) - 2))).run(frame)
            if reports:
                latest = reports[-1]
                metrics = {**latest.result_metrics, "over25": latest.over25_metrics, "baseline": latest.baseline_metrics, "model_comparison": latest.model_comparison, "ml_beats_baseline": latest.ml_beats_baseline, "weights": latest.weights, "total_matches": len(frame)}
            else:
                result_probabilities, _ = artifact.ml.predict(validation[features])
                metrics = {**multiclass_metrics(validation["result_target"], artifact.result_calibrator.transform(result_probabilities)), "total_matches": len(frame)}
            self.db.add(ModelMetric(league_id=league.id, model_version_id=version.id, evaluated_at=datetime.now(timezone.utc), sample_size=len(frame), metrics=metrics, feature_importance=artifact.ml.feature_importance()))
            self.db.add(BacktestRun(league_id=league.id, model_version_id=version.id, from_season=seasons[0], to_season=seasons[-1], status="completed", metrics=metrics))
            league_reports[league.code] = metrics
        version.training_end = datetime.now(timezone.utc)
        version.features = sorted(shared_features)
        version.hyperparameters = {"model": "LightGBM", "half_life_days": self.half_life_days, "validation": "walk-forward"}
        version.metrics = league_reports
        current = self.db.scalar(select(ModelVersion).where(ModelVersion.is_production.is_(True)).order_by(ModelVersion.created_at.desc()))
        candidates = [values for values in league_reports.values() if "log_loss" in values]
        if candidates and current is None:
            version.is_production = True
        elif candidates and current and current.metrics:
            candidate_summary = _average_metrics(candidates)
            production_values = [values for values in current.metrics.values() if isinstance(values, dict) and "log_loss" in values]
            if production_values and evaluate_promotion(candidate_summary, _average_metrics(production_values), minimum_matches=1).approved:
                current.is_production = False
                version.is_production = True
        self.db.commit()
        return {"version": version.version, "is_production": version.is_production, "leagues": league_reports}


def _average_metrics(rows: list[dict]) -> dict[str, float]:
    keys = ("log_loss", "brier_score", "calibration_error", "draw_accuracy", "total_matches")
    return {key: sum(float(row.get(key, 0)) for row in rows) / len(rows) for key in keys}
