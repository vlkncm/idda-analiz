from datetime import timezone

import httpx
from sqlalchemy import func, select

from app.models.football import Match
from app.models.operational import MatchTeamStats, OddsSnapshot
from app.modeling.market import remove_vig
from app.providers.football_data_org import FootballDataOrgProvider
from app.providers.football_data_uk import FootballDataUkProvider, normalize_team_name, parse_match_datetime
from app.services.free_data_sync import FreeDataSyncService


CSV = """Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HS,AS,HST,AST,HC,AC,HY,AY,HR,AR,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5
17/08/2025,19:45,Galatasaray,Beşiktaş,2,1,H,14,8,6,3,7,2,2,4,0,1,1.80,3.70,4.50,1.75,2.05
"""


def test_real_football_data_csv_columns_are_parsed() -> None:
    provider = FootballDataUkProvider(client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=CSV))))
    row = provider.get_matches("TR-SL", "2025/2026")[0]
    assert provider.csv_url("TR-SL", "2025/2026").endswith("/2526/T1.csv")
    assert row.home_team_name == "Galatasaray"
    assert row.home_shots == 14 and row.away_shots_on_target == 3
    assert row.home_odds == 1.8 and row.over25_odds == 1.75
    assert row.odds_captured_at < row.kickoff_at


def test_date_and_team_normalization() -> None:
    assert parse_match_datetime("17/08/25", "19:45").tzinfo == timezone.utc
    assert normalize_team_name("Beşiktaş A.Ş.") == "besiktas-a-s"


def test_free_sync_is_idempotent_and_stores_stats_and_odds(session) -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=CSV)))
    service = FreeDataSyncService(session, FootballDataUkProvider(client=client), history_seasons=1)
    first, second = service.sync(), service.sync()
    assert first.leagues == second.leagues == 5
    assert session.scalar(select(func.count()).select_from(Match)) == 5
    assert session.scalar(select(func.count()).select_from(MatchTeamStats)) == 10
    assert session.scalar(select(func.count()).select_from(OddsSnapshot)) == 25


def test_optional_org_provider_skips_without_key() -> None:
    provider = FootballDataOrgProvider(None)
    assert not provider.enabled
    assert provider.get_matches("EN-PL", "2025/2026") == []


def test_vig_removal_sums_to_one() -> None:
    probabilities = remove_vig(1.8, 3.7, 4.5)
    assert abs(sum(probabilities) - 1) < 1e-12
