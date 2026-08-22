from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.football import League, Season
from app.providers.football_data_uk import FootballDataUkProvider, LEAGUES
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class FreeSyncReport:
    leagues: int = 0
    seasons: int = 0
    matches: int = 0
    errors: int = 0


class FreeDataSyncService:
    def __init__(self, session: Session, provider: FootballDataUkProvider, history_seasons: int = 8):
        self.session, self.provider, self.history_seasons = session, provider, history_seasons

    def sync(self) -> FreeSyncReport:
        report = FreeSyncReport()
        current_start = datetime.now(timezone.utc).year if datetime.now(timezone.utc).month >= 7 else datetime.now(timezone.utc).year - 1
        for code, definition in LEAGUES.items():
            league = self.session.scalar(select(League).where(League.code == code))
            if league is None:
                league = League(code=code, name=definition["name"], country_code=definition["country"], timezone=definition["timezone"], provider=self.provider.name, provider_league_id=definition["division"])
                self.session.add(league)
                self.session.flush()
            else:
                league.provider = self.provider.name
                league.provider_league_id = definition["division"]
            self.session.commit()
            report.leagues += 1
            for year in range(current_start - self.history_seasons + 1, current_start + 1):
                name = f"{year}/{year + 1}"
                season = self.session.scalar(select(Season).where(Season.league_id == league.id, Season.name == name))
                if season is None:
                    season = Season(league_id=league.id, name=name, start_date=date(year, 7, 1), end_date=date(year + 1, 6, 30), provider=self.provider.name, provider_season_id=self.provider.season_code(name), is_current=year == current_start)
                    self.session.add(season)
                    self.session.flush()
                    self.session.commit()
                report.seasons += 1
                try:
                    report.matches += IngestionService(self.session).ingest(self.provider, season)
                except Exception as error:
                    self.session.rollback()
                    report.errors += 1
                    logger.error("free_csv_season_failed", extra={"fields": {"league": code, "season": name, "error": str(error)}})
        logger.info("free_data_sync_complete", extra={"fields": asdict(report)})
        return report
