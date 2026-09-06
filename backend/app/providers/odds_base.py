from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class OddsQuote:
    provider_event_id: str
    bookmaker_key: str
    bookmaker_name: str
    market: str
    selection: str
    odds: float
    captured_at: datetime
    point: float | None = None


@dataclass(frozen=True, slots=True)
class BettingSplitRecord:
    market: str
    selection: str
    ticket_percentage: float | None
    money_percentage: float | None
    captured_at: datetime


@runtime_checkable
class OddsProvider(Protocol):
    name: str

    def get_current_odds(self, match: object) -> list[OddsQuote]: ...
    def get_historical_odds(self, match: object) -> list[OddsQuote]: ...
    def get_bookmakers(self, match: object) -> list[str]: ...
    def get_markets(self, match: object) -> list[str]: ...
    def get_betting_splits(self, match: object) -> list[BettingSplitRecord]: ...
    def get_money_percentage(self, match: object) -> list[BettingSplitRecord]: ...
    def get_opening_odds(self, match: object) -> list[OddsQuote]: ...
