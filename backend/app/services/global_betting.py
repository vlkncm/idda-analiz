from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any

import httpx
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.football import Match
from app.models.operational import BettingSplit, OddsSnapshot
from app.providers.odds_base import OddsProvider


class GlobalBettingService:
    def __init__(self, db: Session, provider: OddsProvider, settings: Settings): self.db, self.provider, self.settings = db, provider, settings

    def _ttl(self, match: Match) -> timedelta:
        kickoff = match.kickoff_at if match.kickoff_at.tzinfo else match.kickoff_at.replace(tzinfo=timezone.utc)
        minutes = self.settings.odds_near_kickoff_cache_minutes if kickoff - datetime.now(timezone.utc) <= timedelta(hours=1) else self.settings.odds_cache_minutes
        return timedelta(minutes=minutes)

    def refresh(self, match: Match) -> str | None:
        latest = self.db.scalar(select(OddsSnapshot.captured_at).where(OddsSnapshot.match_id == match.id).order_by(desc(OddsSnapshot.captured_at)))
        now = datetime.now(timezone.utc)
        if latest and (latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)) >= now - self._ttl(match): return None
        if not self.settings.odds_api_key: return "ODDS_API_KEY tanımlı değil; yalnızca saklanan veriler gösteriliyor."
        try: quotes = self.provider.get_current_odds(match)
        except (RuntimeError, LookupError, ValueError, OSError, httpx.HTTPError) as error: return str(error)
        for q in quotes:
            exists = self.db.scalar(select(OddsSnapshot.id).where(OddsSnapshot.match_id == match.id, OddsSnapshot.bookmaker == q.bookmaker_name, OddsSnapshot.market == q.market, OddsSnapshot.selection == q.selection, OddsSnapshot.captured_at == q.captured_at))
            if not exists: self.db.add(OddsSnapshot(match_id=match.id, bookmaker=q.bookmaker_name, bookmaker_key=q.bookmaker_key, market=q.market, selection=q.selection, odds=q.odds, captured_at=q.captured_at, provider=self.provider.name, provider_event_id=q.provider_event_id, point=q.point))
        self.db.commit(); return None

    def analysis(self, match: Match) -> dict:
        warning = self.refresh(match)
        rows = self.db.scalars(select(OddsSnapshot).where(OddsSnapshot.match_id == match.id).order_by(OddsSnapshot.captured_at)).all()
        latest = {(r.bookmaker, r.market, r.selection, r.point): r for r in rows}
        grouped: dict[tuple[str, float | None], list[OddsSnapshot]] = defaultdict(list)
        for row in latest.values(): grouped[(row.market, row.point)].append(row)
        markets: list[dict[str, Any]] = []
        for (market, point), quotes in sorted(grouped.items(), key=lambda x: (x[0][0], x[0][1] or 0)):
            selections: dict[str, list[OddsSnapshot]] = defaultdict(list)
            for quote in quotes: selections[quote.selection].append(quote)
            averages = {name: sum(q.odds for q in values) / len(values) for name, values in selections.items()}
            inverse = {name: 1/value for name, value in averages.items()}; total = sum(inverse.values())
            items: list[dict[str, Any]] = []
            for name, values in selections.items():
                odds = [q.odds for q in values]
                items.append({"name": name, "average_odds": averages[name], "median_odds": median(odds), "min_odds": min(odds), "max_odds": max(odds), "bookmaker_count": len(values), "implied_probability": inverse[name], "normalized_probability": inverse[name]/total if total else None, "quotes": [{"bookmaker": q.bookmaker, "odds": q.odds, "is_highest": q.odds == max(odds), "is_lowest": q.odds == min(odds)} for q in sorted(values, key=lambda x: x.bookmaker)]})
            markets.append({"key": market, "point": point, "margin": total - 1 if total else None, "selections": items})
        h2h = next((m for m in markets if m["key"] in {"h2h", "h2h_3_way"} and m["point"] is None), None)
        consensus: dict[str, Any] | None = None
        if h2h:
            favorite = max(h2h["selections"], key=lambda x: x["normalized_probability"] or 0)
            bookmaker_rows: dict[str, list[OddsSnapshot]] = defaultdict(list)
            for row in latest.values():
                if row.market in {"h2h", "h2h_3_way"}: bookmaker_rows[row.bookmaker].append(row)
            count = sum(1 for values in bookmaker_rows.values() if min(values, key=lambda x: x.odds).selection == favorite["name"])
            ratio = count / len(bookmaker_rows) if bookmaker_rows else 0
            consensus = {"favorite": favorite["name"], "strength": "Yüksek" if ratio >= .75 else "Orta" if ratio >= .55 else "Düşük", "favorite_bookmakers": count, "bookmaker_count": len(bookmaker_rows), "probabilities": [{"selection": s["name"], "probability": s["normalized_probability"]} for s in h2h["selections"]]}
        history: dict[tuple[str, str, str, float | None], list[OddsSnapshot]] = defaultdict(list)
        for row in rows: history[(row.bookmaker, row.market, row.selection, row.point)].append(row)
        movements: list[dict[str, Any]] = []
        for key, values in history.items():
            if len(values) < 2: continue
            opening, current = values[0], values[-1]; change = ((current.odds-opening.odds)/opening.odds)*100; amount = abs(change)
            level = "Güçlü" if amount >= self.settings.odds_movement_strong_percent else "Orta" if amount >= self.settings.odds_movement_medium_percent else "Hafif" if amount >= self.settings.odds_movement_mild_percent else "Stabil"
            movements.append({"bookmaker": key[0], "market": key[1], "selection": key[2], "point": key[3], "opening_odds": opening.odds, "current_odds": current.odds, "change_percent": change, "classification": level if level == "Stabil" else f"{level} {'yükseliş' if change > 0 else 'düşüş'}"})
        split_rows = self.db.scalars(select(BettingSplit).where(BettingSplit.match_id == match.id).order_by(desc(BettingSplit.captured_at))).all()
        split_latest = {(r.market, r.selection): r for r in split_rows}
        splits: list[dict[str, Any]] = [{"market": r.market, "selection": r.selection, "tickets": r.ticket_percentage, "money": r.money_percentage} for r in split_latest.values()]
        divergence = max((abs(s["tickets"]-s["money"]) for s in splits if s["tickets"] is not None and s["money"] is not None), default=None)
        steam = self._steam(movements)
        return {"provider": self.provider.name, "updated_at": max((r.captured_at for r in rows), default=None), "bookmaker_count": len({r.bookmaker for r in latest.values()}), "markets": markets, "consensus": consensus, "movements": movements, "steam_move": steam, "betting_splits": splits, "sharp_public_divergence": divergence, "warning": warning, "disclaimer": "Piyasa ve ayrışma sinyalleri kesin profesyonel bahis göstergesi veya bahis tavsiyesi değildir."}

    @staticmethod
    def _steam(movements: list[dict[str, Any]]) -> dict[str, Any] | None:
        buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for move in movements:
            if move["change_percent"] <= -5: buckets[(move["market"], move["selection"])].append(move)
        found = max(buckets.values(), key=len, default=[])
        return {"detected": True, "bookmaker_count": len(found), "market": found[0]["market"], "selection": found[0]["selection"]} if len(found) >= 3 else None

    @staticmethod
    def feature_payload(data: dict) -> dict:
        result = {key: None for key in ("market_home_probability", "market_draw_probability", "market_away_probability", "home_odds_movement", "draw_odds_movement", "away_odds_movement", "public_home_percentage", "public_draw_percentage", "public_away_percentage", "money_home_percentage", "money_draw_percentage", "money_away_percentage")}
        result.update({"market_consensus_strength": data.get("consensus", {}).get("strength") if data.get("consensus") else None, "sharp_public_divergence": data.get("sharp_public_divergence")})
        return result
