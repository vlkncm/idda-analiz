from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MatchCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    season_id: int
    home_team_id: int
    away_team_id: int
    kickoff_at: datetime
    provider: str = Field(min_length=1, max_length=64)
    external_id: str = Field(min_length=1, max_length=160)
    round_name: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_match(self) -> "MatchCreate":
        if self.home_team_id == self.away_team_id:
            raise ValueError("home and away teams must differ")
        if self.kickoff_at.tzinfo is None or self.kickoff_at.utcoffset() is None:
            raise ValueError("kickoff_at must include a timezone")
        self.kickoff_at = self.kickoff_at.astimezone(timezone.utc)
        return self

