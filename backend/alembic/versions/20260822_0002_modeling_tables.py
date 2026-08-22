"""Add provider detail, feature, backtest and monitoring tables."""

from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "20260822_0002"
down_revision: str | None = "20260822_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def common():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def upgrade() -> None:
    op.create_table("team_match_stats", sa.Column("id", sa.Integer, primary_key=True), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id"), nullable=False), sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False), sa.Column("is_home", sa.Boolean, nullable=False), sa.Column("goals", sa.Integer), sa.Column("goals_conceded", sa.Integer), sa.Column("xg", sa.Float), sa.Column("xga", sa.Float), sa.Column("shots", sa.Integer), sa.Column("shots_on_target", sa.Integer), sa.Column("possession", sa.Float), sa.Column("corners", sa.Integer), *common(), sa.UniqueConstraint("match_id", "team_id", name="uq_team_match_stats_match_team"))
    op.create_table("players", sa.Column("id", sa.Integer, primary_key=True), sa.Column("provider", sa.String(64), nullable=False), sa.Column("provider_player_id", sa.String(160), nullable=False), sa.Column("name", sa.String(180), nullable=False), sa.Column("position_id", sa.Integer), sa.Column("date_of_birth", sa.Date), *common(), sa.UniqueConstraint("provider", "provider_player_id", name="uq_players_provider_player"))
    op.create_table("player_absences", sa.Column("id", sa.Integer, primary_key=True), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id"), nullable=False), sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False), sa.Column("player_id", sa.Integer, sa.ForeignKey("players.id"), nullable=False), sa.Column("reason", sa.String(160), nullable=False), sa.Column("category", sa.String(40)), sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False), *common(), sa.UniqueConstraint("match_id", "player_id", "reason", name="uq_player_absences_match_player_reason"))
    op.create_table("lineups", sa.Column("id", sa.Integer, primary_key=True), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id"), nullable=False), sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False), sa.Column("player_id", sa.Integer, sa.ForeignKey("players.id"), nullable=False), sa.Column("is_starting", sa.Boolean), sa.Column("position_id", sa.Integer), sa.Column("formation_position", sa.Integer), sa.Column("jersey_number", sa.Integer), sa.Column("is_confirmed", sa.Boolean), *common(), sa.UniqueConstraint("match_id", "team_id", "player_id", name="uq_lineups_match_team_player"))
    op.create_table("odds_snapshots", sa.Column("id", sa.Integer, primary_key=True), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id"), nullable=False), sa.Column("bookmaker", sa.String(120), nullable=False), sa.Column("market", sa.String(160), nullable=False), sa.Column("selection", sa.String(160), nullable=False), sa.Column("odds", sa.Float, nullable=False), sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False), *common(), sa.UniqueConstraint("match_id", "bookmaker", "market", "selection", "captured_at", name="uq_odds_snapshots_odds_identity"), sa.CheckConstraint("odds > 1", name="decimal_odds"))
    op.create_index("ix_odds_match_captured", "odds_snapshots", ["match_id", "captured_at"])
    op.create_table("feature_snapshots", sa.Column("id", sa.Integer, primary_key=True), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id"), nullable=False), sa.Column("model_version_id", sa.Integer, sa.ForeignKey("model_versions.id"), nullable=False), sa.Column("as_of", sa.DateTime(timezone=True), nullable=False), sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False), sa.Column("values", sa.JSON, nullable=False), *common(), sa.UniqueConstraint("match_id", "model_version_id", "as_of", name="uq_feature_snapshots_match_model_asof"), sa.CheckConstraint("as_of < kickoff_at", name="before_kickoff"))
    op.create_table("elo_snapshots", sa.Column("id", sa.Integer, primary_key=True), sa.Column("league_id", sa.Integer, sa.ForeignKey("leagues.id"), nullable=False), sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False), sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id")), sa.Column("as_of", sa.DateTime(timezone=True), nullable=False), sa.Column("rating", sa.Float, nullable=False), *common(), sa.UniqueConstraint("league_id", "team_id", "as_of", name="uq_elo_snapshots_league_team_asof"))
    op.create_table("ensemble_weights", sa.Column("id", sa.Integer, primary_key=True), sa.Column("league_id", sa.Integer, sa.ForeignKey("leagues.id"), nullable=False), sa.Column("model_version_id", sa.Integer, sa.ForeignKey("model_versions.id"), nullable=False), sa.Column("ml_weight", sa.Float, nullable=False), sa.Column("dixon_coles_weight", sa.Float, nullable=False), sa.Column("elo_weight", sa.Float, nullable=False), *common(), sa.UniqueConstraint("league_id", "model_version_id", name="uq_ensemble_weights_league_model"), sa.CheckConstraint("ml_weight + dixon_coles_weight + elo_weight BETWEEN 0.999999 AND 1.000001", name="sum_to_one"))
    op.create_table("backtest_runs", sa.Column("id", sa.Integer, primary_key=True), sa.Column("league_id", sa.Integer, sa.ForeignKey("leagues.id"), nullable=False), sa.Column("model_version_id", sa.Integer, sa.ForeignKey("model_versions.id"), nullable=False), sa.Column("from_season", sa.String(32), nullable=False), sa.Column("to_season", sa.String(32), nullable=False), sa.Column("status", sa.String(24), nullable=False), sa.Column("metrics", sa.JSON, nullable=False), *common())
    op.create_table("model_metrics", sa.Column("id", sa.Integer, primary_key=True), sa.Column("league_id", sa.Integer, sa.ForeignKey("leagues.id"), nullable=False), sa.Column("model_version_id", sa.Integer, sa.ForeignKey("model_versions.id"), nullable=False), sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False), sa.Column("sample_size", sa.Integer, nullable=False), sa.Column("metrics", sa.JSON, nullable=False), sa.Column("feature_importance", sa.JSON), *common())
    op.create_index("ix_metrics_league_model", "model_metrics", ["league_id", "model_version_id"])
    op.create_table("sync_states", sa.Column("key", sa.String(180), primary_key=True), sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False), sa.Column("metadata_json", sa.JSON), *common())


def downgrade() -> None:
    op.drop_table("sync_states")
    op.drop_index("ix_metrics_league_model", table_name="model_metrics")
    op.drop_table("model_metrics")
    op.drop_table("backtest_runs")
    op.drop_table("ensemble_weights")
    op.drop_table("elo_snapshots")
    op.drop_table("feature_snapshots")
    op.drop_index("ix_odds_match_captured", table_name="odds_snapshots")
    op.drop_table("odds_snapshots")
    op.drop_table("lineups")
    op.drop_table("player_absences")
    op.drop_table("players")
    op.drop_table("team_match_stats")
