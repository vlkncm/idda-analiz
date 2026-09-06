from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class MatchTeamStats(Base, TimestampMixin):
    __tablename__ = "team_match_stats"
    __table_args__ = (UniqueConstraint("match_id", "team_id", name="match_team"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    is_home: Mapped[bool] = mapped_column(Boolean, nullable=False)
    goals: Mapped[int | None] = mapped_column(Integer)
    goals_conceded: Mapped[int | None] = mapped_column(Integer)
    xg: Mapped[float | None] = mapped_column(Float)
    xga: Mapped[float | None] = mapped_column(Float)
    shots: Mapped[int | None] = mapped_column(Integer)
    shots_on_target: Mapped[int | None] = mapped_column(Integer)
    possession: Mapped[float | None] = mapped_column(Float)
    corners: Mapped[int | None] = mapped_column(Integer)
    yellow_cards: Mapped[int | None] = mapped_column(Integer)
    red_cards: Mapped[int | None] = mapped_column(Integer)


class Player(Base, TimestampMixin):
    __tablename__ = "players"
    __table_args__ = (UniqueConstraint("provider", "provider_player_id", name="provider_player"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_player_id: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    position_id: Mapped[int | None] = mapped_column(Integer)
    date_of_birth: Mapped[date | None] = mapped_column(Date)


class PlayerAbsence(Base, TimestampMixin):
    __tablename__ = "player_absences"
    __table_args__ = (UniqueConstraint("match_id", "player_id", "reason", name="match_player_reason"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False)
    reason: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(40))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Lineup(Base, TimestampMixin):
    __tablename__ = "lineups"
    __table_args__ = (UniqueConstraint("match_id", "team_id", "player_id", name="match_team_player"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False)
    is_starting: Mapped[bool | None] = mapped_column(Boolean)
    position_id: Mapped[int | None] = mapped_column(Integer)
    formation_position: Mapped[int | None] = mapped_column(Integer)
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    is_confirmed: Mapped[bool | None] = mapped_column(Boolean)


class OddsSnapshot(Base, TimestampMixin):
    __tablename__ = "odds_snapshots"
    __table_args__ = (
        UniqueConstraint("match_id", "bookmaker", "market", "selection", "captured_at", name="odds_identity"),
        Index("ix_odds_match_captured", "match_id", "captured_at"),
        CheckConstraint("odds > 1", name="decimal_odds"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    bookmaker: Mapped[str] = mapped_column(String(120), nullable=False)
    market: Mapped[str] = mapped_column(String(160), nullable=False)
    selection: Mapped[str] = mapped_column(String(160), nullable=False)
    odds: Mapped[float] = mapped_column(Float, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(80))
    provider_event_id: Mapped[str | None] = mapped_column(String(160))
    bookmaker_key: Mapped[str | None] = mapped_column(String(120))
    point: Mapped[float | None] = mapped_column(Float)


class BettingSplit(Base, TimestampMixin):
    __tablename__ = "betting_splits"
    __table_args__ = (UniqueConstraint("match_id", "provider", "market", "selection", "captured_at", name="betting_split_identity"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    market: Mapped[str] = mapped_column(String(160), nullable=False)
    selection: Mapped[str] = mapped_column(String(160), nullable=False)
    ticket_percentage: Mapped[float | None] = mapped_column(Float)
    money_percentage: Mapped[float | None] = mapped_column(Float)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FeatureSnapshot(Base, TimestampMixin):
    __tablename__ = "feature_snapshots"
    __table_args__ = (UniqueConstraint("match_id", "model_version_id", "as_of", name="match_model_asof"), CheckConstraint("as_of < kickoff_at", name="before_kickoff"))
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    values: Mapped[dict] = mapped_column(JSON, nullable=False)


class EloSnapshot(Base, TimestampMixin):
    __tablename__ = "elo_snapshots"
    __table_args__ = (UniqueConstraint("league_id", "team_id", "as_of", name="league_team_asof"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"))
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rating: Mapped[float] = mapped_column(Float, nullable=False)


class EnsembleWeight(Base, TimestampMixin):
    __tablename__ = "ensemble_weights"
    __table_args__ = (UniqueConstraint("league_id", "model_version_id", name="league_model"), CheckConstraint("ml_weight + dixon_coles_weight + elo_weight + market_weight BETWEEN 0.999999 AND 1.000001", name="sum_to_one"))
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    ml_weight: Mapped[float] = mapped_column(Float, nullable=False)
    dixon_coles_weight: Mapped[float] = mapped_column(Float, nullable=False)
    elo_weight: Mapped[float] = mapped_column(Float, nullable=False)
    market_weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)


class BacktestRun(Base, TimestampMixin):
    __tablename__ = "backtest_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    from_season: Mapped[str] = mapped_column(String(32), nullable=False)
    to_season: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="completed")
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False)


class ModelMetric(Base, TimestampMixin):
    __tablename__ = "model_metrics"
    __table_args__ = (Index("ix_metrics_league_model", "league_id", "model_version_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False)
    feature_importance: Mapped[dict | None] = mapped_column(JSON)


class SyncState(Base, TimestampMixin):
    __tablename__ = "sync_states"
    key: Mapped[str] = mapped_column(String(180), primary_key=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON)
