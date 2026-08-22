from collections.abc import Generator

from sqlalchemy.orm import Session

from app.db.session import create_session_factory


SessionFactory = create_session_factory()


def get_db() -> Generator[Session, None, None]:
    with SessionFactory() as session:
        yield session

