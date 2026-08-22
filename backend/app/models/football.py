from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class MatchStatus(StrEnum):
    SCHEDULED = "scheduled"
    POSTPONED = "postponed"
    CANCELLED = "cancelled"
    FINISHED = "finished"


class League(Base, TimestampMixin):
    __tablename__ = "leagues"
    __table_args__ = (UniqueConstraint("provider", "provider_league_id", name="provider_league"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_league_id: Mapped[str | None] = mapped_column(String(160))

    seasons: Mapped[list["Season"]] = relationship(back_populates="league")


class Season(Base, TimestampMixin):
    __tablename__ = "seasons"
    __table_args__ = (
        UniqueConstraint("league_id", "name", name="league_name"),
        UniqueConstraint("provider", "provider_season_id", "league_id", name="provider_season_league"),
        CheckConstraint("end_date >= start_date", name="valid_date_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_season_id: Mapped[str | None] = mapped_column(String(160))
    is_current: Mapped[bool] = mapped_column(default=False, nullable=False)

    league: Mapped[League] = relationship(back_populates="seasons")
    team_seasons: Mapped[list["TeamSeason"]] = relationship(back_populates="season")
    matches: Mapped[list["Match"]] = relationship(back_populates="season")


class Team(Base, TimestampMixin):
    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("provider", "provider_team_id", name="provider_team"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_team_id: Mapped[str | None] = mapped_column(String(160))


class TeamSeason(Base, TimestampMixin):
    __tablename__ = "team_seasons"
    __table_args__ = (
        UniqueConstraint("season_id", "team_id", name="season_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)

    season: Mapped[Season] = relationship(back_populates="team_seasons")
    team: Mapped[Team] = relationship()


class Match(Base, TimestampMixin):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("provider", "provider_match_id", name="provider_external_match"),
        CheckConstraint("home_team_id <> away_team_id", name="different_teams"),
        CheckConstraint(
            "(home_score IS NULL AND away_score IS NULL) OR "
            "(home_score IS NOT NULL AND away_score IS NOT NULL "
            "AND home_score >= 0 AND away_score >= 0)",
            name="scores_together_and_non_negative",
        ),
        Index("ix_matches_season_kickoff", "season_id", "kickoff_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    round_name: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[MatchStatus] = mapped_column(
        Enum(
            MatchStatus,
            native_enum=False,
            length=16,
            values_callable=lambda enum: [item.value for item in enum],
        ),
        default=MatchStatus.SCHEDULED,
        nullable=False,
    )
    home_goals: Mapped[int | None] = mapped_column("home_score", Integer)
    away_goals: Mapped[int | None] = mapped_column("away_score", Integer)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column("provider_match_id", String(160), nullable=False)

    season: Mapped[Season] = relationship(back_populates="matches")
    league: Mapped[League] = relationship()
    home_team: Mapped[Team] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship(foreign_keys=[away_team_id])
    predictions: Mapped[list["Prediction"]] = relationship(back_populates="match")


from app.models.prediction import Prediction  # noqa: E402
