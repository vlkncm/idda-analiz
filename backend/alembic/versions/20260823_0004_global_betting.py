"""global betting data

Revision ID: 20260823_0004
Revises: 20260823_0003
"""
from alembic import op
import sqlalchemy as sa

revision = "20260823_0004"
down_revision = "20260823_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("odds_snapshots") as batch:
        batch.add_column(sa.Column("provider", sa.String(80)))
        batch.add_column(sa.Column("provider_event_id", sa.String(160)))
        batch.add_column(sa.Column("bookmaker_key", sa.String(120)))
        batch.add_column(sa.Column("point", sa.Float()))
    op.create_table("betting_splits", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("match_id", sa.Integer(), sa.ForeignKey("matches.id"), nullable=False), sa.Column("provider", sa.String(80), nullable=False), sa.Column("market", sa.String(160), nullable=False), sa.Column("selection", sa.String(160), nullable=False), sa.Column("ticket_percentage", sa.Float()), sa.Column("money_percentage", sa.Float()), sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False), sa.UniqueConstraint("match_id", "provider", "market", "selection", "captured_at", name="betting_split_identity"))


def downgrade() -> None:
    op.drop_table("betting_splits")
    with op.batch_alter_table("odds_snapshots") as batch:
        batch.drop_column("point"); batch.drop_column("bookmaker_key"); batch.drop_column("provider_event_id"); batch.drop_column("provider")
