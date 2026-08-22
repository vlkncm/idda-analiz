from sqlalchemy import text
from sqlalchemy.orm import Session


def test_database_connection_executes_query(session: Session) -> None:
    assert session.execute(text("SELECT 1")).scalar_one() == 1
