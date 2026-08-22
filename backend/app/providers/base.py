from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class TeamRecord:
    external_id: str
    name: str
    country_code: str


@dataclass(frozen=True, slots=True)
class MatchRecord:
    external_id: str
    league_code: str
    season: str
    kickoff_at: datetime
    home_team_external_id: str
    away_team_external_id: str
    home_team_name: str
    away_team_name: str
    home_goals: int | None = None
    away_goals: int | None = None
    home_xg: float | None = None
    away_xg: float | None = None
    home_odds: float | None = None
    draw_odds: float | None = None
    away_odds: float | None = None
    over25_odds: float | None = None
    under25_odds: float | None = None
    home_shots: int | None = None
    away_shots: int | None = None
    home_shots_on_target: int | None = None
    away_shots_on_target: int | None = None
    home_corners: int | None = None
    away_corners: int | None = None
    home_yellow_cards: int | None = None
    away_yellow_cards: int | None = None
    home_red_cards: int | None = None
    away_red_cards: int | None = None
    odds_captured_at: datetime | None = None


@runtime_checkable
class DataProvider(Protocol):
    name: str

    def get_leagues(self) -> list[dict]: ...

    def get_seasons(self, league_id: int) -> list[dict]: ...

    def get_teams(self, league_code: str, season: str) -> list[TeamRecord]: ...

    def get_matches(self, league_code: str, season: str) -> list[MatchRecord]: ...

    def get_standings(self, league_code: str, season: str) -> list[dict]: ...

    def get_team_stats(self, team_external_id: str, season: str) -> dict | None: ...

    def get_xg(self, match_external_id: str) -> dict | None: ...

    def get_injuries(self, match_external_id: str) -> list[dict]: ...

    def get_odds(self, match_external_id: str) -> dict | None: ...

    def get_fixtures(self, season_id: int) -> list[dict]: ...

    def get_fixture(self, fixture_id: int) -> dict: ...

    def get_team_statistics(self, team_id: int, season_id: int) -> dict | None: ...

    def get_lineups(self, fixture_id: int) -> list[dict]: ...

    def get_competitions(self) -> list[dict]: ...

    def get_upcoming_matches(self, league_code: str) -> list[MatchRecord]: ...

    def get_match_stats(self, match_external_id: str) -> dict | None: ...

    def normalize_match(self, raw: dict, league_code: str, season: str) -> MatchRecord: ...
