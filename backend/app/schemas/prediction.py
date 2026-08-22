from datetime import datetime
from math import isclose

from pydantic import BaseModel, Field, model_validator

from app.models.prediction import ConfidenceLevel, ResultCode


class PredictionCreate(BaseModel):
    match_id: int
    model_version_id: int
    prediction_timestamp: datetime
    kickoff_at: datetime
    home_probability: float = Field(ge=0, le=1)
    draw_probability: float = Field(ge=0, le=1)
    away_probability: float = Field(ge=0, le=1)
    over25_probability: float = Field(ge=0, le=1)
    confidence_score: float = Field(ge=0, le=100)
    confidence: ConfidenceLevel
    predicted_result: ResultCode

    @model_validator(mode="after")
    def validate_point_in_time_probabilities(self) -> "PredictionCreate":
        if not isclose(
            self.home_probability + self.draw_probability + self.away_probability,
            1.0,
            abs_tol=1e-6,
        ):
            raise ValueError("1/X/2 probabilities must sum to 1")
        if self.prediction_timestamp >= self.kickoff_at:
            raise ValueError("prediction must be created before kickoff")
        return self

