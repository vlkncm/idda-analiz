from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.football import League, Match, Season, Team
from app.providers.csv_provider import CsvDataProvider
from app.services.ingestion import IngestionService


def test_csv_ingestion_is_idempotent(tmp_path, session: Session) -> None:
    path = tmp_path / "matches.csv"
    path.write_text(
        "match_id,league_code,season,kickoff_at,home_team_id,away_team_id,home_team,away_team,home_goals,away_goals,home_xg,away_xg\n"
        "m1,TR-SL,2026-27,2026-08-22T18:00:00+03:00,gs,bjk,Galatasaray,Beşiktaş,2,1,1.8,0.9\n",
        encoding="utf-8",
    )
    league = League(code="TR-SL", name="Türkiye Süper Lig", country_code="TR", timezone="Europe/Istanbul")
    season = Season(league=league, name="2026-27", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31))
    session.add(season)
    session.commit()
    service = IngestionService(session)
    assert service.ingest(CsvDataProvider(path), season) == 1
    assert service.ingest(CsvDataProvider(path), season) == 1
    assert session.scalar(select(func.count()).select_from(Match)) == 1
    assert session.scalar(select(func.count()).select_from(Team)) == 2

