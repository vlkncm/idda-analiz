"""Add free CSV statistics, market ensemble and prediction outputs."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0003"
down_revision: str | None = "20260822_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("seasons") as batch:
        batch.drop_constraint("uq_seasons_provider_season", type_="unique")
        batch.create_unique_constraint("uq_seasons_provider_season_league", ["provider", "provider_season_id", "league_id"])
    with op.batch_alter_table("team_match_stats") as batch:
        batch.add_column(sa.Column("yellow_cards", sa.Integer()))
        batch.add_column(sa.Column("red_cards", sa.Integer()))
    with op.batch_alter_table("ensemble_weights") as batch:
        batch.drop_constraint("sum_to_one", type_="check")
        batch.add_column(sa.Column("market_weight", sa.Float(), nullable=False, server_default="0"))
        batch.create_check_constraint("sum_to_one", "ml_weight + dixon_coles_weight + elo_weight + market_weight BETWEEN 0.999999 AND 1.000001")
    with op.batch_alter_table("predictions") as batch:
        batch.add_column(sa.Column("model_outputs", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("seasons") as batch:
        batch.drop_constraint("uq_seasons_provider_season_league", type_="unique")
        batch.create_unique_constraint("uq_seasons_provider_season", ["provider", "provider_season_id"])
    with op.batch_alter_table("predictions") as batch:
        batch.drop_column("model_outputs")
    with op.batch_alter_table("ensemble_weights") as batch:
        batch.drop_constraint("sum_to_one", type_="check")
        batch.drop_column("market_weight")
        batch.create_check_constraint("sum_to_one", "ml_weight + dixon_coles_weight + elo_weight BETWEEN 0.999999 AND 1.000001")
    with op.batch_alter_table("team_match_stats") as batch:
        batch.drop_column("red_cards")
        batch.drop_column("yellow_cards")
