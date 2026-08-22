from __future__ import annotations

import hashlib
import time
from collections.abc import Callable
from datetime import datetime, timezone

import httpx

from app.providers.base import MatchRecord, TeamRecord

COMPETITIONS = {"EN-PL": "PL", "DE-BL": "BL1", "IT-SA": "SA", "FR-L1": "FL1"}


class FootballDataOrgProvider:
    """Optional football-data.org v4 adapter; no key means a clean, empty skip."""

    name = "football-data.org"

    def __init__(self, api_key: str | None, base_url: str = "https://api.football-data.org/v4", client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=30, headers={"X-Auth-Token": api_key or ""})
        self.sleep = sleep

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _get(self, path: str, params: dict | None = None) -> dict:
        if not self.api_key:
            return {}
        for attempt in range(3):
            response = self.client.get(f"{self.base_url}/{path.lstrip('/')}", params=params)
            if response.status_code == 429:
                self.sleep(float(response.headers.get("X-RequestCounter-Reset", 2**attempt)))
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError("football-data.org rate limit retry exhausted")

    def get_competitions(self) -> list[dict]:
        return self._get("competitions").get("competitions", [])

    def get_leagues(self) -> list[dict]: return self.get_competitions()

    def get_seasons(self, league_id: int) -> list[dict]: return []

    def normalize_match(self, raw: dict, league_code: str, season: str) -> MatchRecord:
        home, away = raw["homeTeam"], raw["awayTeam"]
        kickoff = datetime.fromisoformat(raw["utcDate"].replace("Z", "+00:00")).astimezone(timezone.utc)
        score = raw.get("score", {}).get("fullTime", {})
        external = str(raw.get("id") or hashlib.sha256(f"{kickoff}|{home['name']}|{away['name']}".encode()).hexdigest()[:32])
        return MatchRecord(external_id=external, league_code=league_code, season=season, kickoff_at=kickoff, home_team_external_id=str(home.get("id") or home["name"]), away_team_external_id=str(away.get("id") or away["name"]), home_team_name=home["name"], away_team_name=away["name"], home_goals=score.get("home"), away_goals=score.get("away"))

    def get_matches(self, league_code: str, season: str) -> list[MatchRecord]:
        if league_code not in COMPETITIONS or not self.enabled:
            return []
        start = season[:4]
        rows = self._get(f"competitions/{COMPETITIONS[league_code]}/matches", {"season": start}).get("matches", [])
        return [self.normalize_match(row, league_code, season) for row in rows]

    def get_upcoming_matches(self, league_code: str) -> list[MatchRecord]:
        if league_code not in COMPETITIONS or not self.enabled:
            return []
        rows = self._get(f"competitions/{COMPETITIONS[league_code]}/matches", {"status": "SCHEDULED"}).get("matches", [])
        season = str(datetime.now(timezone.utc).year)
        return [self.normalize_match(row, league_code, season) for row in rows]

    def get_teams(self, league_code: str, season: str) -> list[TeamRecord]:
        country = league_code.split("-", 1)[0]
        teams = {}
        for match in self.get_matches(league_code, season):
            teams[match.home_team_external_id] = TeamRecord(match.home_team_external_id, match.home_team_name, country)
            teams[match.away_team_external_id] = TeamRecord(match.away_team_external_id, match.away_team_name, country)
        return list(teams.values())

    def get_match_stats(self, match_external_id: str) -> dict | None: return None
    def get_odds(self, match_external_id: str) -> dict | None: return None
    def get_standings(self, league_code: str, season: str) -> list[dict]: return []
    def get_team_stats(self, team_external_id: str, season: str) -> dict | None: return None
    def get_xg(self, match_external_id: str) -> dict | None: return None
    def get_injuries(self, match_external_id: str) -> list[dict]: return []
    def get_fixtures(self, season_id: int) -> list[dict]: return []
    def get_fixture(self, fixture_id: int) -> dict: raise KeyError(fixture_id)
    def get_team_statistics(self, team_id: int, season_id: int) -> dict | None: return None
    def get_lineups(self, fixture_id: int) -> list[dict]: return []
