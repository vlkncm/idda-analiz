"""Add the sixth supported league, La Liga.

Revision ID: 20260903_0005
Revises: 20260823_0004
"""

from alembic import op
import sqlalchemy as sa

revision = "20260903_0005"
down_revision = "20260823_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    leagues = sa.table(
        "leagues",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("country_code", sa.String),
        sa.column("timezone", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    connection = op.get_bind()
    if connection.execute(sa.select(leagues.c.code).where(leagues.c.code == "ES-LL")).first() is None:
        op.bulk_insert(leagues, [{"code": "ES-LL", "name": "La Liga", "country_code": "ES", "timezone": "Europe/Madrid", "is_active": True}])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM leagues WHERE code = 'ES-LL'"))
