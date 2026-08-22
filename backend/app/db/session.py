from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


def create_session_factory(database_url: str | None = None) -> sessionmaker[Session]:
    url = database_url or get_settings().database_url
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

