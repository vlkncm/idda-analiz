import csv
from datetime import datetime, timezone
from pathlib import Path

from app.providers.base import MatchRecord, TeamRecord


def _optional_number(value: str | None, cast):
    return None if value is None or not value.strip() else cast(value)


class CsvDataProvider:
    """Documented, repeatable fallback when a licensed API is unavailable."""

    name = "csv"

    def __init__(self, matches_path: str | Path):
        self.matches_path = Path(matches_path)

    def get_matches(self, league_code: str, season: str) -> list[MatchRecord]:
        records: list[MatchRecord] = []
        with self.matches_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                if row["league_code"] != league_code or row["season"] != season:
                    continue
                kickoff = datetime.fromisoformat(row["kickoff_at"].replace("Z", "+00:00"))
                if kickoff.tzinfo is None:
                    raise ValueError("CSV kickoff_at must include a timezone")
                records.append(
                    MatchRecord(
                        external_id=row["match_id"].strip(),
                        league_code=league_code,
                        season=season,
                        kickoff_at=kickoff.astimezone(timezone.utc),
                        home_team_external_id=row["home_team_id"].strip(),
                        away_team_external_id=row["away_team_id"].strip(),
                        home_team_name=row["home_team"].strip(),
                        away_team_name=row["away_team"].strip(),
                        home_goals=_optional_number(row.get("home_goals"), int),
                        away_goals=_optional_number(row.get("away_goals"), int),
                        home_xg=_optional_number(row.get("home_xg"), float),
                        away_xg=_optional_number(row.get("away_xg"), float),
                        home_odds=_optional_number(row.get("home_odds"), float),
                        draw_odds=_optional_number(row.get("draw_odds"), float),
                        away_odds=_optional_number(row.get("away_odds"), float),
                        over25_odds=_optional_number(row.get("over25_odds"), float),
                    )
                )
        return records

    def get_leagues(self) -> list[dict]:
        return []

    def get_seasons(self, league_id: int) -> list[dict]:
        return []

    def get_fixtures(self, season_id: int) -> list[dict]:
        return []

    def get_fixture(self, fixture_id: int) -> dict:
        raise KeyError(fixture_id)

    def get_team_statistics(self, team_id: int, season_id: int) -> dict | None:
        return None

    def get_lineups(self, fixture_id: int) -> list[dict]:
        return []

    def get_teams(self, league_code: str, season: str) -> list[TeamRecord]:
        matches = self.get_matches(league_code, season)
        teams: dict[str, TeamRecord] = {}
        country_code = league_code.split("-", 1)[0]
        for match in matches:
            teams[match.home_team_external_id] = TeamRecord(match.home_team_external_id, match.home_team_name, country_code)
            teams[match.away_team_external_id] = TeamRecord(match.away_team_external_id, match.away_team_name, country_code)
        return sorted(teams.values(), key=lambda item: item.external_id)

    def get_standings(self, league_code: str, season: str) -> list[dict]:
        return []

    def get_team_stats(self, team_external_id: str, season: str) -> dict | None:
        return None

    def get_xg(self, match_external_id: str) -> dict | None:
        return None

    def get_injuries(self, match_external_id: str) -> list[dict]:
        return []

    def get_odds(self, match_external_id: str) -> dict | None:
        return None
