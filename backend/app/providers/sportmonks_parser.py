from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True, slots=True)
class ParsedFixture:
    provider_match_id: str
    league_provider_id: str
    season_provider_id: str
    kickoff_at: datetime
    status: str
    home_provider_team_id: str
    away_provider_team_id: str
    home_name: str
    away_name: str
    home_score: int | None
    away_score: int | None
    team_stats: tuple[dict, ...]
    lineups: tuple[dict, ...]
    absences: tuple[dict, ...]


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _participants(fixture: dict) -> tuple[dict, dict]:
    rows = fixture.get("participants") or []
    by_location = {(row.get("meta") or {}).get("location") or row.get("location"): row for row in rows}
    if "home" not in by_location or "away" not in by_location:
        raise ValueError(f"fixture {fixture.get('id')} has no home/away participants")
    return by_location["home"], by_location["away"]


def _scores(fixture: dict) -> tuple[int | None, int | None]:
    rows = fixture.get("scores") or []
    preferred = [row for row in rows if str(row.get("description", "")).upper() in {"CURRENT", "2ND_HALF"}]
    chosen = preferred or rows
    result: dict[str, int] = {}
    for row in chosen:
        score = row.get("score") or {}
        participant = score.get("participant")
        goals = score.get("goals")
        if participant in {"home", "away"} and goals is not None:
            result[participant] = int(goals)
    return result.get("home"), result.get("away")


def _status(fixture: dict, home_score: int | None, away_score: int | None) -> str:
    state = fixture.get("state") or {}
    value = str(state.get("developer_name") or state.get("name") or "").upper()
    if any(token in value for token in ("FINISHED", "FT", "AFTER_EXTRA_TIME", "AFTER_PENALTIES")) or (fixture.get("result_info") and home_score is not None and away_score is not None):
        return "finished"
    if "POSTPON" in value:
        return "postponed"
    if any(token in value for token in ("CANCEL", "ABANDON")):
        return "cancelled"
    return "scheduled"


def _stat_name(row: dict) -> str:
    type_data = row.get("type") or {}
    return str(type_data.get("developer_name") or type_data.get("name") or "").upper().replace(" ", "_")


def _number(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("value") or value.get("total")
    try:
        return float(str(value).rstrip("%"))
    except (TypeError, ValueError):
        return None


def _team_stats(fixture: dict, home: dict, away: dict, scores: tuple[int | None, int | None]) -> tuple[dict, ...]:
    locations = {int(home["id"]): (True, scores[0], scores[1]), int(away["id"]): (False, scores[1], scores[0])}
    values = {team_id: {"provider_team_id": str(team_id), "is_home": meta[0], "goals": meta[1], "goals_conceded": meta[2], "xg": None, "xga": None, "shots": None, "shots_on_target": None, "possession": None, "corners": None} for team_id, meta in locations.items()}
    mapping = {"SHOTS_TOTAL": "shots", "SHOTS": "shots", "SHOTS_ON_TARGET": "shots_on_target", "BALL_POSSESSION": "possession", "POSSESSION": "possession", "CORNERS": "corners", "CORNERS_TOTAL": "corners"}
    for row in fixture.get("statistics") or []:
        participant_id = row.get("participant_id")
        if participant_id not in values:
            continue
        field = mapping.get(_stat_name(row))
        if field:
            values[participant_id][field] = _number(row.get("data"))
    expected = fixture.get("expected") or fixture.get("xgfixture") or []
    for row in expected:
        participant_id = row.get("participant_id")
        if participant_id in values:
            values[participant_id]["xg"] = _number(row.get("data"))
    if values[int(home["id"])]["xg"] is not None:
        values[int(away["id"])]["xga"] = values[int(home["id"])]["xg"]
    if values[int(away["id"])]["xg"] is not None:
        values[int(home["id"])]["xga"] = values[int(away["id"])]["xg"]
    return tuple(values.values())


def parse_fixture(fixture: dict) -> ParsedFixture:
    home, away = _participants(fixture)
    scores = _scores(fixture)
    lineups = tuple({"provider_player_id": str(row["player_id"]), "provider_team_id": str(row["team_id"]), "player_name": row.get("player_name") or (row.get("player") or {}).get("name") or f"Player {row['player_id']}", "position_id": row.get("position_id"), "formation_position": row.get("formation_position"), "jersey_number": row.get("jersey_number"), "is_starting": row.get("formation_position") is not None, "is_confirmed": (fixture.get("metadata") or {}).get("lineup_confirmed")} for row in fixture.get("lineups") or [] if row.get("player_id") and row.get("team_id"))
    absences = []
    for row in fixture.get("sidelined") or []:
        player = row.get("player") or {}
        player_id = row.get("player_id") or player.get("id")
        team_id = row.get("team_id")
        if not player_id or not team_id:
            continue
        sideline = row.get("sideline") or {}
        absences.append({"provider_player_id": str(player_id), "provider_team_id": str(team_id), "player_name": player.get("display_name") or player.get("name") or f"Player {player_id}", "reason": sideline.get("name") or row.get("reason") or "unavailable", "category": sideline.get("category") or row.get("type")})
    return ParsedFixture(str(fixture["id"]), str(fixture["league_id"]), str(fixture["season_id"]), _parse_datetime(fixture["starting_at"]), _status(fixture, *scores), str(home["id"]), str(away["id"]), home.get("name") or home.get("display_name"), away.get("name") or away.get("display_name"), scores[0], scores[1], _team_stats(fixture, home, away, scores), lineups, tuple(absences))


def parse_odds(rows: list[dict], captured_at: datetime | None = None) -> list[dict]:
    default_time = captured_at or datetime.now(timezone.utc)
    parsed = []
    for row in rows:
        try:
            value = float(row["value"])
        except (KeyError, TypeError, ValueError):
            continue
        bookmaker = row.get("bookmaker") or {}
        market = row.get("market") or {}
        timestamp = row.get("latest_bookmaker_update") or row.get("updated_at")
        parsed.append({"bookmaker": bookmaker.get("name") or str(row.get("bookmaker_id")), "market": market.get("name") or row.get("market_description") or str(row.get("market_id")), "selection": row.get("label") or row.get("name") or "unknown", "odds": value, "captured_at": _parse_datetime(timestamp) if timestamp else default_time})
    return parsed
