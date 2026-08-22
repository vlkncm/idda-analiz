"""PHASE 1 core football and prediction schema."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260822_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "leagues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("provider", sa.String(64)),
        sa.Column("provider_league_id", sa.String(160)),
        *timestamps(),
        sa.UniqueConstraint("provider", "provider_league_id", name="uq_leagues_provider_league"),
    )
    op.bulk_insert(
        sa.table(
            "leagues",
            sa.column("code", sa.String),
            sa.column("name", sa.String),
            sa.column("country_code", sa.String),
            sa.column("timezone", sa.String),
        ),
        [
            {"code": "TR-SL", "name": "Türkiye Süper Lig", "country_code": "TR", "timezone": "Europe/Istanbul"},
            {"code": "EN-PL", "name": "Premier League", "country_code": "GB", "timezone": "Europe/London"},
            {"code": "FR-L1", "name": "Ligue 1", "country_code": "FR", "timezone": "Europe/Paris"},
            {"code": "IT-SA", "name": "Serie A", "country_code": "IT", "timezone": "Europe/Rome"},
            {"code": "DE-BL", "name": "Bundesliga", "country_code": "DE", "timezone": "Europe/Berlin"},
        ],
    )
    op.create_table(
        "seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("league_id", sa.Integer(), sa.ForeignKey("leagues.id"), nullable=False),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("provider", sa.String(64)),
        sa.Column("provider_season_id", sa.String(160)),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        *timestamps(),
        sa.UniqueConstraint("league_id", "name", name="uq_seasons_league_name"),
        sa.UniqueConstraint("provider", "provider_season_id", name="uq_seasons_provider_season"),
        sa.CheckConstraint("end_date >= start_date", name="valid_date_range"),
    )
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("provider", sa.String(64)),
        sa.Column("provider_team_id", sa.String(160)),
        *timestamps(),
        sa.UniqueConstraint("provider", "provider_team_id", name="uq_teams_provider_team"),
    )
    op.create_table(
        "team_seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("seasons.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("season_id", "team_id", name="uq_team_seasons_season_team"),
    )
    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("league_id", sa.Integer(), sa.ForeignKey("leagues.id"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("seasons.id"), nullable=False),
        sa.Column("home_team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("away_team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("round_name", sa.String(80)),
        sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("home_score", sa.Integer()),
        sa.Column("away_score", sa.Integer()),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("provider_match_id", sa.String(160), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("provider", "provider_match_id", name="uq_matches_provider_external_match"),
        sa.CheckConstraint("home_team_id <> away_team_id", name="different_teams"),
        sa.CheckConstraint(
            "(home_score IS NULL AND away_score IS NULL) OR "
            "(home_score IS NOT NULL AND away_score IS NOT NULL AND home_score >= 0 AND away_score >= 0)",
            name="scores_together_and_non_negative",
        ),
    )
    op.create_index("ix_matches_season_kickoff", "matches", ["season_id", "kickoff_at"])
    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.String(32), nullable=False, unique=True),
        sa.Column("description", sa.String(500)),
        sa.Column("is_production", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("training_start", sa.DateTime(timezone=True)),
        sa.Column("training_end", sa.DateTime(timezone=True)),
        sa.Column("features", sa.JSON()),
        sa.Column("hyperparameters", sa.JSON()),
        sa.Column("metrics", sa.JSON()),
        *timestamps(),
    )
    op.create_table(
        "predictions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("matches.id"), nullable=False),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("model_versions.id"), nullable=False),
        sa.Column("prediction_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("home_probability", sa.Float(), nullable=False),
        sa.Column("draw_probability", sa.Float(), nullable=False),
        sa.Column("away_probability", sa.Float(), nullable=False),
        sa.Column("over25_probability", sa.Float(), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.String(16), nullable=False),
        sa.Column("predicted_result", sa.String(1), nullable=False),
        sa.Column("actual_result", sa.String(1)),
        sa.Column("actual_total_goals", sa.Integer()),
        sa.Column("actual_over25", sa.Boolean()),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("feature_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("explanation", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("model_agreement", sa.Float()),
        *timestamps(),
        sa.CheckConstraint("prediction_timestamp < kickoff_at", name="before_kickoff"),
        sa.CheckConstraint("home_probability BETWEEN 0 AND 1", name="home_probability"),
        sa.CheckConstraint("draw_probability BETWEEN 0 AND 1", name="draw_probability"),
        sa.CheckConstraint("away_probability BETWEEN 0 AND 1", name="away_probability"),
        sa.CheckConstraint("over25_probability BETWEEN 0 AND 1", name="over25_probability"),
        sa.CheckConstraint("confidence_score BETWEEN 0 AND 100", name="confidence_score"),
        sa.CheckConstraint(
            "home_probability + draw_probability + away_probability BETWEEN 0.999999 AND 1.000001",
            name="result_probability_sum",
        ),
        sa.CheckConstraint(
            "(actual_result IS NULL AND actual_total_goals IS NULL) OR "
            "(actual_result IS NOT NULL AND actual_total_goals >= 0)",
            name="actuals_together_and_non_negative",
        ),
    )


def downgrade() -> None:
    op.drop_table("predictions")
    op.drop_table("model_versions")
    op.drop_index("ix_matches_season_kickoff", table_name="matches")
    op.drop_table("matches")
    op.drop_table("team_seasons")
    op.drop_table("teams")
    op.drop_table("seasons")
    op.drop_table("leagues")
