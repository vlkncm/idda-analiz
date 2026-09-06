from __future__ import annotations

import csv
import hashlib
import io
import logging
import re
import time
import unicodedata
from collections.abc import Callable
from datetime import datetime, timezone

import httpx

from app.providers.base import MatchRecord, TeamRecord

logger = logging.getLogger(__name__)

LEAGUES = {
    "TR-SL": {"division": "T1", "name": "Süper Lig", "country": "TR", "timezone": "Europe/Istanbul"},
    "EN-PL": {"division": "E0", "name": "Premier League", "country": "GB", "timezone": "Europe/London"},
    "ES-LL": {"division": "SP1", "name": "La Liga", "country": "ES", "timezone": "Europe/Madrid"},
    "DE-BL": {"division": "D1", "name": "Bundesliga", "country": "DE", "timezone": "Europe/Berlin"},
    "IT-SA": {"division": "I1", "name": "Serie A", "country": "IT", "timezone": "Europe/Rome"},
    "FR-L1": {"division": "F1", "name": "Ligue 1", "country": "FR", "timezone": "Europe/Paris"},
}


class FootballDataUkError(RuntimeError):
    pass


def normalize_team_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.strip()).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def parse_match_datetime(date_value: str, time_value: str | None = None) -> datetime:
    raw = date_value.strip()
    parsed = None
    for pattern in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(raw, pattern)
            break
        except ValueError:
            continue
    if parsed is None:
        raise ValueError(f"unsupported Football-Data date: {date_value!r}")
    if time_value and time_value.strip():
        hour, minute = (int(part) for part in time_value.strip().split(":")[:2])
        parsed = parsed.replace(hour=hour, minute=minute)
    return parsed.replace(tzinfo=timezone.utc)


def _number(row: dict[str, str], key: str, cast=float):
    value = row.get(key)
    if value is None or not value.strip():
        return None
    try:
        return cast(float(value))
    except (ValueError, TypeError):
        return None


def _average(row: dict[str, str], keys: tuple[str, ...]) -> float | None:
    values = [_number(row, key) for key in keys]
    valid = [value for value in values if value is not None and value > 1]
    return sum(valid) / len(valid) if valid else None


class FootballDataUkProvider:
    """Adapter for Football-Data.co.uk's documented, free CSV downloads."""

    name = "football-data.co.uk"

    def __init__(self, base_url: str = "https://www.football-data.co.uk", timeout: float = 30, retries: int = 3, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep):
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": "IDDA-Analysis/1.0 (respectful CSV client)"})
        self.retries = retries
        self.sleep = sleep
        self._cache: dict[tuple[str, str], list[MatchRecord]] = {}

    @staticmethod
    def season_code(season: str) -> str:
        start = int(season[:4])
        return f"{start % 100:02d}{(start + 1) % 100:02d}"

    def csv_url(self, league_code: str, season: str) -> str:
        division = LEAGUES[league_code]["division"]
        return f"{self.base_url}/mmz4281/{self.season_code(season)}/{division}.csv"

    def _download(self, url: str) -> str:
        for attempt in range(self.retries + 1):
            try:
                response = self.client.get(url)
                response.raise_for_status()
                logger.info("football_data_uk_download", extra={"fields": {"url": url, "http_status": response.status_code, "bytes": len(response.content)}})
                return response.content.decode("utf-8-sig", errors="replace")
            except httpx.HTTPError as error:
                if attempt == self.retries:
                    raise FootballDataUkError(f"CSV indirilemedi: {url} ({getattr(error.response, 'status_code', 'network')})") from error
                self.sleep(min(8, 2**attempt))
        raise AssertionError("unreachable")

    def get_competitions(self) -> list[dict]:
        return self.get_leagues()

    def get_leagues(self) -> list[dict]:
        return [{"code": code, "id": item["division"], **item} for code, item in LEAGUES.items()]

    def get_seasons(self, league_id: int | str) -> list[dict]:
        now = datetime.now(timezone.utc)
        start = now.year if now.month >= 7 else now.year - 1
        return [{"name": f"{year}/{year + 1}", "id": f"{year % 100:02d}{(year + 1) % 100:02d}"} for year in range(start, start - 10, -1)]

    def parse_csv(self, content: str, league_code: str, season: str) -> list[MatchRecord]:
        rows = csv.DictReader(io.StringIO(content))
        division = LEAGUES[league_code]["division"]
        return [self.normalize_match(row, league_code, season) for row in rows if row.get("HomeTeam") and row.get("AwayTeam") and row.get("Date") and (not row.get("Div") or row.get("Div") == division)]

    def normalize_match(self, raw: dict, league_code: str, season: str) -> MatchRecord:
        home, away = raw["HomeTeam"].strip(), raw["AwayTeam"].strip()
        kickoff = parse_match_datetime(raw["Date"], raw.get("Time"))
        identity = f"{LEAGUES[league_code]['division']}|{season}|{kickoff.isoformat()}|{home}|{away}"
        closing = ("AvgCH", "AvgCD", "AvgCA")
        opening = ("AvgH", "AvgD", "AvgA")
        odds = tuple(_number(raw, key) for key in closing)
        if not all(odds):
            odds = tuple(_number(raw, key) for key in opening)
        if not all(odds):
            odds = (
                _average(raw, ("B365CH", "BWCH", "IWCH", "PSCH", "WHCH", "B365H", "BWH", "IWH", "PSH", "WHH")),
                _average(raw, ("B365CD", "BWCD", "IWCD", "PSCD", "WHCD", "B365D", "BWD", "IWD", "PSD", "WHD")),
                _average(raw, ("B365CA", "BWCA", "IWCA", "PSCA", "WHCA", "B365A", "BWA", "IWA", "PSA", "WHA")),
            )
        over = _number(raw, "AvgC>2.5") or _number(raw, "Avg>2.5") or _average(raw, ("B365C>2.5", "PC>2.5", "B365>2.5", "P>2.5"))
        under = _number(raw, "AvgC<2.5") or _number(raw, "Avg<2.5") or _average(raw, ("B365C<2.5", "PC<2.5", "B365<2.5", "P<2.5"))
        return MatchRecord(
            external_id=hashlib.sha256(identity.encode()).hexdigest()[:32], league_code=league_code, season=season, kickoff_at=kickoff,
            home_team_external_id=normalize_team_name(home), away_team_external_id=normalize_team_name(away), home_team_name=home, away_team_name=away,
            home_goals=_number(raw, "FTHG", int), away_goals=_number(raw, "FTAG", int), home_odds=odds[0], draw_odds=odds[1], away_odds=odds[2],
            over25_odds=over, under25_odds=under, home_shots=_number(raw, "HS", int), away_shots=_number(raw, "AS", int),
            home_shots_on_target=_number(raw, "HST", int), away_shots_on_target=_number(raw, "AST", int), home_corners=_number(raw, "HC", int), away_corners=_number(raw, "AC", int),
            home_yellow_cards=_number(raw, "HY", int), away_yellow_cards=_number(raw, "AY", int), home_red_cards=_number(raw, "HR", int), away_red_cards=_number(raw, "AR", int),
            # Football-Data CSV exposes opening/closing prices but no exact
            # capture timestamp. Never fabricate one for point-in-time models.
            odds_captured_at=None,
        )

    def get_matches(self, league_code: str, season: str) -> list[MatchRecord]:
        key = (league_code, season)
        if key not in self._cache:
            self._cache[key] = self.parse_csv(self._download(self.csv_url(league_code, season)), league_code, season)
        return self._cache[key]

    def get_upcoming_matches(self, league_code: str) -> list[MatchRecord]:
        content = self._download(f"{self.base_url}/matches/resources/fixtures.csv")
        season = self.get_seasons(LEAGUES[league_code]["division"])[0]["name"]
        return [row for row in self.parse_csv(content, league_code, season) if row.league_code == league_code and row.kickoff_at > datetime.now(timezone.utc)]

    def get_teams(self, league_code: str, season: str) -> list[TeamRecord]:
        country = LEAGUES[league_code]["country"]
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
