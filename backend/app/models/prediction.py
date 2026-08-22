from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, JSON, String, event, inspect
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ResultCode(StrEnum):
    HOME = "1"
    DRAW = "X"
    AWAY = "2"


class ConfidenceLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class ModelVersion(Base, TimestampMixin):
    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    is_production: Mapped[bool] = mapped_column(default=False, nullable=False)
    training_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    training_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    features: Mapped[list | None] = mapped_column(JSON)
    hyperparameters: Mapped[dict | None] = mapped_column(JSON)
    metrics: Mapped[dict | None] = mapped_column(JSON)


class Prediction(Base, TimestampMixin):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint("prediction_timestamp < kickoff_at", name="before_kickoff"),
        CheckConstraint("home_probability BETWEEN 0 AND 1", name="home_probability"),
        CheckConstraint("draw_probability BETWEEN 0 AND 1", name="draw_probability"),
        CheckConstraint("away_probability BETWEEN 0 AND 1", name="away_probability"),
        CheckConstraint("over25_probability BETWEEN 0 AND 1", name="over25_probability"),
        CheckConstraint("confidence_score BETWEEN 0 AND 100", name="confidence_score"),
        CheckConstraint(
            "home_probability + draw_probability + away_probability "
            "BETWEEN 0.999999 AND 1.000001",
            name="result_probability_sum",
        ),
        CheckConstraint(
            "(actual_result IS NULL AND actual_total_goals IS NULL) OR "
            "(actual_result IS NOT NULL AND actual_total_goals >= 0)",
            name="actuals_together_and_non_negative",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    model_version_id: Mapped[int] = mapped_column(
        ForeignKey("model_versions.id"), nullable=False
    )
    prediction_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    home_probability: Mapped[float] = mapped_column(Float, nullable=False)
    draw_probability: Mapped[float] = mapped_column(Float, nullable=False)
    away_probability: Mapped[float] = mapped_column(Float, nullable=False)
    over25_probability: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[ConfidenceLevel] = mapped_column(
        Enum(
            ConfidenceLevel,
            native_enum=False,
            length=16,
            values_callable=lambda enum: [item.value for item in enum],
        ),
        nullable=False,
    )
    predicted_result: Mapped[ResultCode] = mapped_column(
        Enum(
            ResultCode,
            native_enum=False,
            length=1,
            values_callable=lambda enum: [item.value for item in enum],
        ),
        nullable=False,
    )
    actual_result: Mapped[ResultCode | None] = mapped_column(
        Enum(
            ResultCode,
            native_enum=False,
            length=1,
            values_callable=lambda enum: [item.value for item in enum],
        )
    )
    actual_total_goals: Mapped[int | None]
    actual_over25: Mapped[bool | None] = mapped_column(Boolean)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    feature_snapshot: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), nullable=False, default=dict)
    explanation: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    model_agreement: Mapped[float | None] = mapped_column(Float)
    model_outputs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    match: Mapped["Match"] = relationship(back_populates="predictions")
    model_version: Mapped[ModelVersion] = relationship()


from app.models.football import Match  # noqa: E402


IMMUTABLE_PREDICTION_FIELDS = ("home_probability", "draw_probability", "away_probability", "over25_probability", "predicted_result", "confidence", "confidence_score", "feature_snapshot", "explanation", "model_agreement", "model_outputs", "prediction_timestamp", "model_version_id", "match_id")


@event.listens_for(Prediction, "before_update")
def protect_prediction_snapshot(mapper, connection, target: Prediction) -> None:
    state = inspect(target)
    changed = [field for field in IMMUTABLE_PREDICTION_FIELDS if state.attrs[field].history.has_changes()]
    if changed:
        raise ValueError(f"stored prediction fields are immutable: {', '.join(changed)}")
