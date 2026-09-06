from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.football import League, Match, Season, Team
from app.providers.odds_base import OddsQuote
from app.providers.the_odds_api import normalize_team_name
from app.services.global_betting import GlobalBettingService


class FakeOddsProvider:
    name = "test-odds"

    def get_current_odds(self, match: object) -> list[OddsQuote]:
        now = datetime.now(timezone.utc)
        prices = {"Home": [1.8, 1.9], "Draw": [3.4, 3.5], "Away": [4.2, 4.4]}
        return [OddsQuote("event-1", f"book-{index}", f"Book {index}", "h2h", selection, odds, now) for selection, values in prices.items() for index, odds in enumerate(values)]

    def get_historical_odds(self, match: object): return []
    def get_bookmakers(self, match: object): return []
    def get_markets(self, match: object): return []
    def get_betting_splits(self, match: object): return []
    def get_money_percentage(self, match: object): return []
    def get_opening_odds(self, match: object): return []


def _match(session: Session) -> Match:
    league = League(code="EN-PL", name="Premier League", country_code="GB", timezone="Europe/London")
    season = Season(league=league, name="2026/27", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31))
    home, away = Team(code="home", name="Home", country_code="GB"), Team(code="away", name="Away", country_code="GB")
    match = Match(league=league, season=season, home_team=home, away_team=away, kickoff_at=datetime.now(timezone.utc)+timedelta(days=1), provider="test", external_id="m1")
    session.add(match); session.commit(); return match


def test_team_alias_normalization() -> None:
    assert normalize_team_name("Man Utd FC") == "manchester united"
    assert normalize_team_name("Manchester United") == "manchester united"


def test_consensus_is_vig_normalized_and_dynamic(session: Session) -> None:
    settings = Settings(odds_api_key="test", odds_cache_minutes=10)
    result = GlobalBettingService(session, FakeOddsProvider(), settings).analysis(_match(session))
    assert result["bookmaker_count"] == 2
    assert result["consensus"]["favorite"] == "Home"
    assert abs(sum(item["probability"] for item in result["consensus"]["probabilities"]) - 1) < 1e-9
    assert result["betting_splits"] == []
