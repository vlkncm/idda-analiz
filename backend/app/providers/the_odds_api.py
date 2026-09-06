from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

import httpx

from app.providers.odds_base import BettingSplitRecord, OddsQuote


LEAGUE_SPORT_KEYS = {
    "EPL": "soccer_epl", "ENPL": "soccer_epl", "PL": "soccer_epl", "GB1": "soccer_epl",
    "BUNDESLIGA": "soccer_germany_bundesliga", "BL1": "soccer_germany_bundesliga", "D1": "soccer_germany_bundesliga",
    "LALIGA": "soccer_spain_la_liga", "PD": "soccer_spain_la_liga", "SP1": "soccer_spain_la_liga",
    "SERIEA": "soccer_italy_serie_a", "SA": "soccer_italy_serie_a", "I1": "soccer_italy_serie_a",
    "LIGUE1": "soccer_france_ligue_one", "FL1": "soccer_france_ligue_one", "F1": "soccer_france_ligue_one",
    "SUPERLIG": "soccer_turkey_super_league", "TRSL": "soccer_turkey_super_league", "TR1": "soccer_turkey_super_league", "T1": "soccer_turkey_super_league",
    "UCL": "soccer_uefa_champs_league", "CL": "soccer_uefa_champs_league",
}
TEAM_ALIASES = {"man utd": "manchester united", "man united": "manchester united", "psg": "paris saint germain", "inter milan": "internazionale"}
MARKETS = "h2h,draw_no_bet,totals,alternate_totals,btts,spreads,alternate_spreads,team_totals,alternate_team_totals,h2h_h1,totals_h1,btts_h1"


def normalize_team_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(fc|cf|afc|sc|fk|club|calcio)\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return TEAM_ALIASES.get(text, text)


class TheOddsApiProvider:
    name = "The Odds API"

    def __init__(self, api_key: str | None, base_url: str, regions: str = "eu,uk", tolerance_minutes: int = 90, client: httpx.Client | None = None):
        self.api_key, self.base_url, self.regions = api_key, base_url.rstrip("/"), regions
        self.tolerance = timedelta(minutes=tolerance_minutes)
        self.client = client or httpx.Client(timeout=30)

    def _sport_key(self, match: object) -> str:
        code = str(getattr(getattr(match, "league", None), "code", "")).upper().replace("-", "").replace("_", "")
        key = LEAGUE_SPORT_KEYS.get(code)
        if not key:
            raise LookupError(f"{code or 'Bilinmeyen lig'} için odds sport key eşlemesi yok")
        return key

    def _get(self, path: str, **params: str | int | float | bool | None) -> object:
        if not self.api_key:
            raise RuntimeError("ODDS_API_KEY tanımlı değil")
        request_params: dict[str, str | int | float | bool | None] = {"apiKey": self.api_key}
        request_params.update(params)
        response = self.client.get(f"{self.base_url}/{path.lstrip('/')}", params=request_params)
        response.raise_for_status()
        return response.json()

    def _event(self, match: object) -> tuple[str, str]:
        sport = self._sport_key(match)
        kickoff = getattr(match, "kickoff_at")
        if kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=timezone.utc)
        events = self._get(f"sports/{sport}/events", dateFormat="iso", commenceTimeFrom=(kickoff-self.tolerance).isoformat(), commenceTimeTo=(kickoff+self.tolerance).isoformat())
        home, away = normalize_team_name(getattr(match, "home_team").name), normalize_team_name(getattr(match, "away_team").name)
        best: tuple[float, dict] | None = None
        for event in events if isinstance(events, list) else []:
            score = (SequenceMatcher(None, home, normalize_team_name(event.get("home_team", ""))).ratio() + SequenceMatcher(None, away, normalize_team_name(event.get("away_team", ""))).ratio()) / 2
            if best is None or score > best[0]: best = (score, event)
        if not best or best[0] < .72:
            raise LookupError("Sağlayıcıda güvenilir maç eşleşmesi bulunamadı")
        return sport, str(best[1]["id"])

    def get_current_odds(self, match: object) -> list[OddsQuote]:
        sport, event_id = self._event(match)
        raw = self._get(f"sports/{sport}/events/{event_id}/odds", regions=self.regions, markets=MARKETS, oddsFormat="decimal", dateFormat="iso")
        quotes: list[OddsQuote] = []
        for bookmaker in raw.get("bookmakers", []) if isinstance(raw, dict) else []:
            for market in bookmaker.get("markets", []):
                captured = datetime.fromisoformat(str(market.get("last_update") or bookmaker.get("last_update")).replace("Z", "+00:00"))
                for outcome in market.get("outcomes", []):
                    price = float(outcome.get("price", 0))
                    if price > 1:
                        selection = str(outcome.get("name", "unknown"))
                        if outcome.get("description"): selection = f"{outcome['description']} — {selection}"
                        quotes.append(OddsQuote(event_id, str(bookmaker.get("key", bookmaker.get("title"))), str(bookmaker.get("title", bookmaker.get("key"))), str(market.get("key")), selection, price, captured, float(outcome["point"]) if outcome.get("point") is not None else None))
        return quotes

    def get_historical_odds(self, match: object) -> list[OddsQuote]: return []
    def get_opening_odds(self, match: object) -> list[OddsQuote]: return []
    def get_betting_splits(self, match: object) -> list[BettingSplitRecord]: return []
    def get_money_percentage(self, match: object) -> list[BettingSplitRecord]: return []
    def get_bookmakers(self, match: object) -> list[str]: return sorted({q.bookmaker_name for q in self.get_current_odds(match)})
    def get_markets(self, match: object) -> list[str]: return sorted({q.market for q in self.get_current_odds(match)})
