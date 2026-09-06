from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import httpx


logger = logging.getLogger(__name__)


class ProviderConfigurationError(RuntimeError):
    pass


class ProviderRequestError(RuntimeError):
    pass


class SportmonksProvider:
    """Sportmonks Football API v3 adapter using only documented endpoints/includes."""

    name = "sportmonks"

    def __init__(self, api_key: str | None, base_url: str = "https://api.sportmonks.com/v3/football", timeout: float = 30, max_retries: int = 3, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep, cache_get: Callable[[str], dict | None] | None = None, cache_set: Callable[[str, dict], None] | None = None):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.client = client or httpx.Client(timeout=timeout)
        self.sleep = sleep
        self.cache_get = cache_get
        self.cache_set = cache_set

    def _cache_key(self, path: str, params: dict[str, Any]) -> str:
        safe = "&".join(f"{key}={params[key]}" for key in sorted(params))
        return "sportmonks:" + hashlib.sha256(f"{path}?{safe}".encode()).hexdigest()

    def _request(self, path: str, params: dict[str, Any] | None = None, cache: bool = False) -> dict:
        if not self.api_key:
            raise ProviderConfigurationError("SPORTMONKS_API_KEY tanımlı değil. Anahtarı backend .env dosyasına ekleyin.")
        request_params = dict(params or {})
        cache_key = self._cache_key(path, request_params)
        if cache and self.cache_get and (cached := self.cache_get(cache_key)) is not None:
            return cached
        request_params["api_token"] = self.api_key
        for attempt in range(self.max_retries + 1):
            try:
                response = self.client.get(f"{self.base_url}/{path.lstrip('/')}", params=request_params)
                if response.status_code == 429:
                    body = response.json()
                    wait = float(body.get("retry_after") or body.get("rate_limit", {}).get("resets_in_seconds") or 2**attempt)
                    logger.warning("sportmonks_rate_limited", extra={"fields": {"endpoint": path, "http_status": 429, "retry_after": wait}})
                    if attempt == self.max_retries:
                        raise ProviderRequestError(f"Sportmonks rate limit aşıldı; {wait:.0f} saniye sonra tekrar deneyin")
                    self.sleep(wait)
                    continue
                response.raise_for_status()
                payload = response.json()
                rate = payload.get("rate_limit") or {}
                logger.info("sportmonks_request", extra={"fields": {"endpoint": path, "http_status": response.status_code, "rate_remaining": rate.get("remaining")}})
                if cache and self.cache_set:
                    self.cache_set(cache_key, payload)
                return payload
            except (httpx.HTTPError, ValueError) as error:
                status = getattr(getattr(error, "response", None), "status_code", None)
                logger.error("sportmonks_request_failed", extra={"fields": {"endpoint": path, "http_status": status, "error_type": type(error).__name__}})
                if attempt == self.max_retries:
                    raise ProviderRequestError(f"Sportmonks isteği başarısız: {path} ({status or 'network'})") from error
                self.sleep(float(2**attempt))
        raise AssertionError("unreachable")

    def _paginated(self, path: str, params: dict[str, Any] | None = None, cache: bool = False) -> list[dict]:
        page, rows = 1, []
        while True:
            payload = self._request(path, {**(params or {}), "page": page, "per_page": 50}, cache=cache)
            data = payload.get("data") or []
            rows.extend(data if isinstance(data, list) else [data])
            pagination = payload.get("pagination") or {}
            if not pagination.get("has_more"):
                return rows
            page += 1

    def get_leagues(self) -> list[dict]:
        return self._paginated("leagues", {"include": "country;currentSeason;seasons"}, cache=True)

    def get_seasons(self, league_id: int) -> list[dict]:
        data = self._request(f"leagues/{league_id}", {"include": "seasons"}, cache=True).get("data") or {}
        return data.get("seasons") or []

    def get_teams(self, league_code_or_season: int | str, season: str | None = None):
        if not isinstance(league_code_or_season, int):
            return []
        return self._paginated(f"teams/seasons/{league_code_or_season}", cache=True)

    def get_fixtures(self, season_id: int) -> list[dict]:
        stages = self._request(f"schedules/seasons/{season_id}", cache=True).get("data") or []
        fixtures: dict[int, dict] = {}
        for stage in stages:
            for round_data in stage.get("rounds") or []:
                for fixture in round_data.get("fixtures") or []:
                    fixtures[fixture["id"]] = fixture
            for fixture in stage.get("fixtures") or []:
                fixtures[fixture["id"]] = fixture
        return sorted(fixtures.values(), key=lambda item: item.get("starting_at") or "")

    def get_fixture(self, fixture_id: int) -> dict:
        includes = "participants;scores;statistics.type;lineups.details;sidelined.player;xGFixture;coaches"
        return (self._request(f"fixtures/{fixture_id}", {"include": includes}).get("data") or {})

    def get_team_statistics(self, team_id: int, season_id: int) -> dict | None:
        data = self._request(f"teams/{team_id}", {"include": "statistics.details", "filters": f"teamStatisticSeasons:{season_id}"}).get("data")
        return data or None

    def get_lineups(self, fixture_id: int) -> list[dict]:
        return self.get_fixture(fixture_id).get("lineups") or []

    def get_injuries(self, fixture_id: int) -> list[dict]:
        return self.get_fixture(fixture_id).get("sidelined") or []

    def get_xg(self, fixture_id: int) -> dict | None:
        fixture = self.get_fixture(fixture_id)
        rows = fixture.get("expected") or fixture.get("xgfixture") or []
        return {str(row.get("participant_id")): (row.get("data") or {}).get("value") for row in rows} or None

    def get_odds(self, fixture_id: int) -> dict | None:
        rows = self._paginated(f"odds/pre-match/fixtures/{fixture_id}", {"include": "market;bookmaker"})
        return {"data": rows} if rows else None

    def get_matches(self, league_code: str, season: str):
        return []

    def get_standings(self, league_code: str, season: str) -> list[dict]:
        return []

    def get_team_stats(self, team_external_id: str, season: str) -> dict | None:
        return None


TARGET_LEAGUES = {
    ("Süper Lig", "Turkey"): "TR-SL",
    ("Premier League", "England"): "EN-PL",
    ("La Liga", "Spain"): "ES-LL",
    ("Bundesliga", "Germany"): "DE-BL",
    ("Serie A", "Italy"): "IT-SA",
    ("Ligue 1", "France"): "FR-L1",
}


def discover_target_leagues(rows: list[dict]) -> list[tuple[str, dict]]:
    found = []
    for row in rows:
        country = row.get("country") or {}
        country_name = country.get("name")
        key = (row.get("name"), country_name)
        if key in TARGET_LEAGUES:
            found.append((TARGET_LEAGUES[key], row))
    missing = set(TARGET_LEAGUES.values()).difference(code for code, _ in found)
    if missing:
        raise ProviderRequestError(f"Sportmonks aboneliğinde hedef ligler bulunamadı: {', '.join(sorted(missing))}")
    return found
