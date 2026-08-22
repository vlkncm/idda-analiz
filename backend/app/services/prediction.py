from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.football import Match
from app.models.operational import FeatureSnapshot
from app.models.prediction import ConfidenceLevel, ModelVersion, Prediction, ResultCode
from app.modeling.artifact import PredictionArtifact
from app.services.explanation import explain_prediction


class PredictionService:
    def __init__(self, session: Session):
        self.session = session

    def predict_and_store(self, match: Match, model_version: ModelVersion, artifact: PredictionArtifact, features: dict[str, float], dixon_coles: tuple[float, float, float, float], elo: tuple[float, float, float] | None = None, prediction_timestamp: datetime | None = None) -> tuple[Prediction, list[str]]:
        timestamp = prediction_timestamp or datetime.now(timezone.utc)
        kickoff = match.kickoff_at
        if kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=timezone.utc)
        if timestamp >= kickoff:
            raise ValueError("predictions can only be created before kickoff")
        output = artifact.predict(features, dixon_coles, elo)
        explanation = explain_prediction(features, output["component_probabilities"])
        values = (output["home"], output["draw"], output["away"])
        winner = (ResultCode.HOME, ResultCode.DRAW, ResultCode.AWAY)[max(range(3), key=values.__getitem__)]
        prediction = Prediction(match_id=match.id, model_version_id=model_version.id, prediction_timestamp=timestamp, kickoff_at=kickoff, home_probability=output["home"], draw_probability=output["draw"], away_probability=output["away"], over25_probability=output["over25"], confidence_score=output["confidence_score"], confidence=ConfidenceLevel(output["confidence"]), predicted_result=winner, feature_snapshot=dict(features), explanation=explanation, model_agreement=output["agreement"], model_outputs=output["component_probabilities"])
        snapshot = FeatureSnapshot(match_id=match.id, model_version_id=model_version.id, as_of=timestamp, kickoff_at=kickoff, values=features)
        self.session.add_all([prediction, snapshot])
        self.session.commit()
        return prediction, explanation
