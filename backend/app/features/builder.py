from dataclasses import dataclass
from datetime import datetime, timedelta
from math import exp, log

from app.modeling.market import remove_vig


@dataclass(frozen=True, slots=True)
class HistoricalMatch:
    kickoff_at: datetime
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    home_xg: float | None = None
    away_xg: float | None = None
    competition: str = "league"
    home_shots: int | None = None
    away_shots: int | None = None
    home_shots_on_target: int | None = None
    away_shots_on_target: int | None = None


@dataclass(frozen=True, slots=True)
class MatchContext:
    league_id: int
    home_rank: int | None = None
    away_rank: int | None = None
    home_points_per_match: float | None = None
    away_points_per_match: float | None = None
    home_goal_difference_per_match: float | None = None
    away_goal_difference_per_match: float | None = None
    home_coach_changed_at: datetime | None = None
    away_coach_changed_at: datetime | None = None
    home_squad_impact: float | None = None
    away_squad_impact: float | None = None
    home_missing_players: int | None = None
    away_missing_players: int | None = None
    home_missing_key_players: int | None = None
    away_missing_key_players: int | None = None
    odds: tuple[float, float, float, float | None] | tuple[float, float, float, float | None, float | None] | None = None


class FeatureBuilder:
    def __init__(self, half_life_days: float = 180.0, enable_h2h: bool = False):
        if half_life_days <= 0:
            raise ValueError("half_life_days must be positive")
        self.half_life_days = half_life_days
        self.enable_h2h = enable_h2h

    def _weight(self, age_days: float) -> float:
        return exp(-log(2) * age_days / self.half_life_days)

    def build(self, home_team: str, away_team: str, kickoff_at: datetime, history: list[HistoricalMatch], elo: dict[str, float] | None = None, context: MatchContext | None = None) -> dict[str, float]:
        if kickoff_at.tzinfo is None:
            raise ValueError("kickoff_at must be timezone-aware")
        eligible = sorted((m for m in history if m.kickoff_at < kickoff_at), key=lambda m: m.kickoff_at)
        features: dict[str, float] = {}
        features.update(self._team_features(home_team, kickoff_at, eligible, True, elo or {}))
        home_values = {f"home_{key}": value for key, value in features.items()}
        features = self._team_features(away_team, kickoff_at, eligible, False, elo or {})
        away_values = {f"away_{key}": value for key, value in features.items()}
        result = {**home_values, **away_values}
        home_rating = (elo or {}).get(home_team, 1500.0)
        away_rating = (elo or {}).get(away_team, 1500.0)
        result["home_elo"] = home_rating
        result["away_elo"] = away_rating
        result["elo_difference"] = home_rating - away_rating
        if self.enable_h2h:
            result.update(self._h2h(home_team, away_team, kickoff_at, eligible))
        if context:
            result.update(self._context_features(context, kickoff_at, eligible, home_team, away_team))
        result.update(self._canonical_aliases(result))
        return result

    @staticmethod
    def _canonical_aliases(values: dict[str, float]) -> dict[str, float]:
        aliases: dict[str, float] = {}
        for side in ("home", "away"):
            for window in (5, 10):
                prefix = f"{side}_form_{window}"
                aliases[f"{side}_last{window}_points_per_game"] = values[f"{prefix}_ppm"]
                aliases[f"{side}_last{window}_goals_for"] = values[f"{prefix}_goals_for"]
                aliases[f"{side}_last{window}_goals_against"] = values[f"{prefix}_goals_against"]
                aliases[f"{side}_last{window}_goal_difference"] = values[f"{prefix}_goals_for"] - values[f"{prefix}_goals_against"]
            venue = "home" if side == "home" else "away"
            aliases[f"{side}_team_{venue}_ppg"] = values[f"{side}_venue_ppg"]
            aliases[f"{side}_team_{venue}_goals_for"] = values[f"{side}_venue_goals_for"]
            aliases[f"{side}_{venue}_ppg"] = values[f"{side}_venue_ppg"]
            aliases[f"{side}_{venue}_gf"] = values[f"{side}_venue_goals_for"]
            aliases[f"{side}_{venue}_ga"] = values[f"{side}_venue_goals_against"]
            aliases[f"{side}_shots_avg"] = values[f"{side}_shots_avg"]
            aliases[f"{side}_sot_avg"] = values[f"{side}_sot_avg"]
            aliases[f"strength_adjusted_form_{side}"] = values[f"{side}_form_5_ppm"]
            aliases[f"{side}_team_{venue}_goals_against"] = values[f"{side}_venue_goals_against"]
            aliases[f"{side}_xg_avg"] = values[f"{side}_form_10_xg"]
            aliases[f"{side}_xga_avg"] = values[f"{side}_form_10_xga"]
            aliases[f"{side}_recent_xg"] = values[f"{side}_form_5_xg"]
            aliases[f"{side}_xg_diff"] = aliases[f"{side}_xg_avg"] - aliases[f"{side}_xga_avg"]
            aliases[f"{side}_rest_days"] = values[f"{side}_rest_days"]
        return aliases

    def _context_features(self, context: MatchContext, as_of: datetime, history: list[HistoricalMatch], home: str, away: str) -> dict[str, float]:
        values = {
            "league_id": float(context.league_id),
            "rank_difference": float((context.away_rank or 0) - (context.home_rank or 0)),
            "points_per_match_difference": (context.home_points_per_match or 0) - (context.away_points_per_match or 0),
            "goal_difference_per_match_difference": (context.home_goal_difference_per_match or 0) - (context.away_goal_difference_per_match or 0),
            "home_squad_impact": context.home_squad_impact or 0.0,
            "away_squad_impact": context.away_squad_impact or 0.0,
            "squad_data_missing": float(context.home_squad_impact is None or context.away_squad_impact is None),
            "home_missing_players": float(context.home_missing_players or 0),
            "away_missing_players": float(context.away_missing_players or 0),
            "home_missing_key_players": float(context.home_missing_key_players or 0),
            "away_missing_key_players": float(context.away_missing_key_players or 0),
        }
        for prefix, team, changed_at in (("home", home, context.home_coach_changed_at), ("away", away, context.away_coach_changed_at)):
            valid_change = changed_at is not None and changed_at < as_of
            values[f"{prefix}_coach_changed"] = float(valid_change)
            values[f"{prefix}_matches_since_coach_change"] = float(sum(changed_at < match.kickoff_at < as_of and team in (match.home_team, match.away_team) for match in history)) if valid_change else 999.0
        if context.odds:
            home_odds, draw_odds, away_odds, over_odds, *under_values = context.odds
            under_odds = under_values[0] if under_values else None
            market = remove_vig(home_odds, draw_odds, away_odds)
            over_probability = remove_vig(over_odds, under_odds)[0] if over_odds and under_odds and over_odds > 1 and under_odds > 1 else 1 / over_odds if over_odds and over_odds > 1 else 0.0
            values.update({"market_home_probability": market[0], "market_draw_probability": market[1], "market_away_probability": market[2], "market_over25_probability": over_probability, "market_data_missing": 0.0})
        else:
            values.update({"market_home_probability": 0.0, "market_draw_probability": 0.0, "market_away_probability": 0.0, "market_over25_probability": 0.0, "market_data_missing": 1.0})
        return values

    def _team_features(self, team: str, as_of: datetime, history: list[HistoricalMatch], home_split: bool, elo: dict[str, float]) -> dict[str, float]:
        all_team = [m for m in history if team in (m.home_team, m.away_team)]
        split = [m for m in all_team if (m.home_team == team) is home_split]
        output: dict[str, float] = {}
        for window in (5, 10):
            sample = all_team[-window:]
            weighted_points = weighted_for = weighted_against = weight_sum = 0.0
            xg_for = xg_against = xg_count = 0.0
            overs = 0
            for match in sample:
                is_home = match.home_team == team
                goals_for = match.home_goals if is_home else match.away_goals
                goals_against = match.away_goals if is_home else match.home_goals
                points = 3 if goals_for > goals_against else 1 if goals_for == goals_against else 0
                opponent = match.away_team if is_home else match.home_team
                opponent_factor = max(0.75, min(1.25, elo.get(opponent, 1500) / 1500))
                weight = self._weight((as_of - match.kickoff_at).total_seconds() / 86400) * opponent_factor
                weighted_points += points * weight
                weighted_for += goals_for * weight
                weighted_against += goals_against * weight
                weight_sum += weight
                if match.home_xg is not None and match.away_xg is not None:
                    xg_for += match.home_xg if is_home else match.away_xg
                    xg_against += match.away_xg if is_home else match.home_xg
                    xg_count += 1
                overs += goals_for + goals_against >= 3
            divisor = weight_sum or 1.0
            output[f"form_{window}_ppm"] = weighted_points / divisor
            output[f"form_{window}_goals_for"] = weighted_for / divisor
            output[f"form_{window}_goals_against"] = weighted_against / divisor
            output[f"form_{window}_over25_rate"] = overs / len(sample) if sample else 0.0
            output[f"form_{window}_xg"] = xg_for / xg_count if xg_count else 0.0
            output[f"form_{window}_xga"] = xg_against / xg_count if xg_count else 0.0
            output[f"form_{window}_xg_missing"] = float(xg_count == 0)
        venue = split[-10:]
        scored = [m.home_goals if home_split else m.away_goals for m in venue]
        conceded = [m.away_goals if home_split else m.home_goals for m in venue]
        output["venue_goals_for"] = sum(scored) / len(scored) if scored else 0.0
        output["venue_goals_against"] = sum(conceded) / len(conceded) if conceded else 0.0
        output["venue_win_rate"] = sum(a > b for a, b in zip(scored, conceded)) / len(venue) if venue else 0.0
        output["venue_draw_rate"] = sum(a == b for a, b in zip(scored, conceded)) / len(venue) if venue else 0.0
        output["venue_ppg"] = sum(3 if a > b else 1 if a == b else 0 for a, b in zip(scored, conceded)) / len(venue) if venue else 0.0
        output["venue_loss_rate"] = sum(a < b for a, b in zip(scored, conceded)) / len(venue) if venue else 0.0
        shot_sample = all_team[-10:]
        shots = [m.home_shots if m.home_team == team else m.away_shots for m in shot_sample]
        sot = [m.home_shots_on_target if m.home_team == team else m.away_shots_on_target for m in shot_sample]
        valid_shots, valid_sot = [v for v in shots if v is not None], [v for v in sot if v is not None]
        output["shots_avg"] = sum(valid_shots) / len(valid_shots) if valid_shots else 0.0
        output["sot_avg"] = sum(valid_sot) / len(valid_sot) if valid_sot else 0.0
        output["shots_missing"] = float(not valid_shots)
        output["rest_days"] = min(30.0, (as_of - all_team[-1].kickoff_at).total_seconds() / 86400) if all_team else 30.0
        output["matches_7d"] = sum(m.kickoff_at >= as_of - timedelta(days=7) for m in all_team)
        output["matches_14d"] = sum(m.kickoff_at >= as_of - timedelta(days=14) for m in all_team)
        output["europe_last_7d"] = float(any(m.competition == "europe" and m.kickoff_at >= as_of - timedelta(days=7) for m in all_team))
        return output

    def _h2h(self, home: str, away: str, as_of: datetime, history: list[HistoricalMatch]) -> dict[str, float]:
        cutoff = as_of - timedelta(days=3 * 365)
        matches = [m for m in history if m.kickoff_at >= cutoff and {m.home_team, m.away_team} == {home, away}][-5:]
        if not matches:
            return {"h2h_home_points": 0.0, "h2h_matches": 0.0}
        points = 0.0
        for match in matches:
            home_goals = match.home_goals if match.home_team == home else match.away_goals
            away_goals = match.away_goals if match.home_team == home else match.home_goals
            points += 3 if home_goals > away_goals else 1 if home_goals == away_goals else 0
        return {"h2h_home_points": points / (3 * len(matches)), "h2h_matches": float(len(matches))}
