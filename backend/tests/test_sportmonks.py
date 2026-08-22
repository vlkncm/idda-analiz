import json
import os
from pathlib import Path

import httpx
import pytest

from app.providers.sportmonks import ProviderConfigurationError, ProviderRequestError, SportmonksProvider, discover_target_leagues
from app.providers.sportmonks_parser import parse_fixture, parse_odds


FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sportmonks_fixture.json").read_text(encoding="utf-8"))


def test_sportmonks_fixture_parser_uses_documented_includes() -> None:
    parsed = parse_fixture(FIXTURE)
    assert parsed.provider_match_id == "19424997"
    assert (parsed.home_name, parsed.away_name) == ("Home FC", "Away FC")
    assert (parsed.home_score, parsed.away_score, parsed.status) == (2, 1, "finished")
    assert parsed.team_stats[0]["xg"] == 1.84
    assert parsed.team_stats[1]["xga"] == 1.84
    assert parsed.lineups[0]["provider_player_id"] == "101"
    assert parsed.absences[0]["category"] == "injury"


def test_odds_parser_preserves_each_snapshot_selection() -> None:
    rows = [{"fixture_id": 1, "market_id": 1, "bookmaker_id": 28, "label": "1", "value": "2.05", "market_description": "Match Winner", "bookmaker": {"name": "Example Book"}, "market": {"name": "Fulltime Result"}, "updated_at": "2026-08-23T12:00:00Z"}]
    parsed = parse_odds(rows)
    assert parsed[0]["bookmaker"] == "Example Book"
    assert parsed[0]["selection"] == "1"
    assert parsed[0]["odds"] == 2.05


def test_missing_api_key_has_clear_error() -> None:
    with pytest.raises(ProviderConfigurationError, match="SPORTMONKS_API_KEY"):
        SportmonksProvider(None).get_leagues()


def test_429_uses_retry_after_without_leaking_token() -> None:
    calls = []
    responses = iter([httpx.Response(429, json={"retry_after": 3}), httpx.Response(200, json={"data": [], "pagination": {"has_more": False}, "rate_limit": {"remaining": 99}})])
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        response = next(responses)
        response.request = request
        return response
    waits = []
    provider = SportmonksProvider("secret-token", client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=waits.append)
    assert provider.get_leagues() == []
    assert waits == [3]
    assert len(calls) == 2


def test_league_discovery_validates_name_and_country() -> None:
    rows = [{"id": index, "name": name, "country": {"name": country}} for index, (name, country) in enumerate([("Süper Lig", "Turkey"), ("Premier League", "England"), ("Bundesliga", "Germany"), ("Serie A", "Italy"), ("Ligue 1", "France")], 1)]
    assert {code for code, _ in discover_target_leagues(rows)} == {"TR-SL", "EN-PL", "DE-BL", "IT-SA", "FR-L1"}
    with pytest.raises(ProviderRequestError, match="bulunamadı"):
        discover_target_leagues(rows[:-1])


@pytest.mark.skipif(not os.getenv("SPORTMONKS_API_KEY"), reason="API key required")
def test_live_sportmonks_integration_when_key_is_available() -> None:
    rows = SportmonksProvider(os.environ["SPORTMONKS_API_KEY"]).get_leagues()
    assert rows
