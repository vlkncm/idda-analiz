from dataclasses import dataclass, field
from datetime import datetime
from math import log1p

import numpy as np
from sklearn.linear_model import LogisticRegression


@dataclass(slots=True)
class EloPrediction:
    home: float
    draw: float
    away: float


@dataclass(frozen=True, slots=True)
class EloMatch:
    kickoff_at: datetime
    league: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True, slots=True)
class PreMatchElo:
    kickoff_at: datetime
    league: str
    home_team: str
    away_team: str
    home_rating: float
    away_rating: float


@dataclass(slots=True)
class EloEngine:
    k_factor: float = 24.0
    initial_rating: float = 1500.0
    home_advantages: dict[str, float] = field(default_factory=dict)
    ratings: dict[str, dict[str, float]] = field(default_factory=dict)

    def rating(self, league: str, team: str) -> float:
        return self.ratings.setdefault(league, {}).setdefault(team, self.initial_rating)

    def predict(self, league: str, home_team: str, away_team: str) -> EloPrediction:
        advantage = self.home_advantages.get(league, 65.0)
        difference = self.rating(league, home_team) + advantage - self.rating(league, away_team)
        decisive_home = 1.0 / (1.0 + 10 ** (-difference / 400.0))
        draw = max(0.16, 0.29 - abs(difference) / 3000.0)
        return EloPrediction(decisive_home * (1 - draw), draw, (1 - decisive_home) * (1 - draw))

    def update(self, league: str, home_team: str, away_team: str, home_goals: int, away_goals: int) -> None:
        before = self.predict(league, home_team, away_team)
        actual = 1.0 if home_goals > away_goals else 0.5 if home_goals == away_goals else 0.0
        expected = before.home + before.draw / 2
        multiplier = 1.0 + log1p(abs(home_goals - away_goals))
        change = self.k_factor * multiplier * (actual - expected)
        self.ratings[league][home_team] = self.rating(league, home_team) + change
        self.ratings[league][away_team] = self.rating(league, away_team) - change

    def fit_home_advantage(self, league: str, matches: list[tuple[int, int]]) -> float:
        if not matches:
            return self.home_advantages.setdefault(league, 65.0)
        home_points = sum(1 if h > a else 0.5 if h == a else 0 for h, a in matches) / len(matches)
        clipped = min(0.80, max(0.20, home_points))
        advantage = 400.0 * __import__("math").log10(clipped / (1 - clipped))
        self.home_advantages[league] = max(-50.0, min(150.0, advantage))
        return self.home_advantages[league]

    def process_history(self, matches: list[EloMatch]) -> list[PreMatchElo]:
        snapshots = []
        for match in sorted(matches, key=lambda item: item.kickoff_at):
            snapshots.append(PreMatchElo(match.kickoff_at, match.league, match.home_team, match.away_team, self.rating(match.league, match.home_team), self.rating(match.league, match.away_team)))
            self.update(match.league, match.home_team, match.away_team, match.home_goals, match.away_goals)
        return snapshots


class EloThreeWayCalibrator:
    """Learns league-specific 1/X/2 probabilities from pre-match Elo differences."""

    def __init__(self):
        self.models: dict[str, LogisticRegression] = {}

    def fit(self, league: str, elo_differences, results) -> "EloThreeWayCalibrator":
        differences = np.asarray(elo_differences, dtype=float).reshape(-1, 1)
        labels = np.asarray(results, dtype=int)
        if set(labels) != {0, 1, 2}:
            raise ValueError("Elo calibration requires home, draw and away examples")
        model = LogisticRegression(max_iter=1000, class_weight="balanced")
        model.fit(differences, labels)
        self.models[league] = model
        return self

    def predict(self, league: str, elo_difference: float) -> EloPrediction:
        if league not in self.models:
            raise RuntimeError(f"Elo 3-way calibrator is not fitted for {league}")
        model = self.models[league]
        raw = model.predict_proba([[elo_difference]])[0]
        by_class = {int(label): float(value) for label, value in zip(model.classes_, raw)}
        return EloPrediction(by_class[0], by_class[1], by_class[2])
