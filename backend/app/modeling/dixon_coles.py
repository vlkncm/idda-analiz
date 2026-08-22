from dataclasses import dataclass
from datetime import datetime
from math import exp, factorial, log

import numpy as np
from scipy.optimize import minimize


@dataclass(frozen=True, slots=True)
class ScorePrediction:
    home: float
    draw: float
    away: float
    over25: float
    expected_home_goals: float
    expected_away_goals: float
    matrix: tuple[tuple[float, ...], ...]


@dataclass(frozen=True, slots=True)
class DixonColesMatch:
    kickoff_at: datetime
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True, slots=True)
class DixonColesParameters:
    attack: dict[str, float]
    defence: dict[str, float]
    home_advantage: float
    rho: float
    fitted_until: datetime


def poisson_probability(goals: int, expected: float) -> float:
    return exp(-expected) * expected**goals / factorial(goals)


def dixon_coles_tau(home_goals: int, away_goals: int, home_xg: float, away_xg: float, rho: float) -> float:
    if home_goals == 0 and away_goals == 0:
        return 1 - home_xg * away_xg * rho
    if home_goals == 0 and away_goals == 1:
        return 1 + home_xg * rho
    if home_goals == 1 and away_goals == 0:
        return 1 + away_xg * rho
    if home_goals == 1 and away_goals == 1:
        return 1 - rho
    return 1.0


class DixonColesEngine:
    def __init__(self, max_goals: int = 10, rho: float = -0.08):
        if max_goals < 7:
            raise ValueError("score matrix must cover at least 0..7 goals")
        self.max_goals = max_goals
        self.rho = rho
        self.parameters: DixonColesParameters | None = None

    def fit(self, matches: list[DixonColesMatch], half_life_days: float = 365.0) -> DixonColesParameters:
        if len(matches) < 20:
            raise ValueError("at least 20 historical matches are required")
        ordered = sorted(matches, key=lambda item: item.kickoff_at)
        teams = sorted({match.home_team for match in ordered} | {match.away_team for match in ordered})
        index = {team: position for position, team in enumerate(teams)}
        latest = ordered[-1].kickoff_at

        def objective(values: np.ndarray) -> float:
            attacks = values[: len(teams)]
            defences = values[len(teams) : 2 * len(teams)]
            home_advantage, rho = values[-2], values[-1]
            loss = 0.0
            for match in ordered:
                home_xg = exp(home_advantage + attacks[index[match.home_team]] + defences[index[match.away_team]])
                away_xg = exp(attacks[index[match.away_team]] + defences[index[match.home_team]])
                probability = poisson_probability(match.home_goals, home_xg) * poisson_probability(match.away_goals, away_xg) * dixon_coles_tau(match.home_goals, match.away_goals, home_xg, away_xg, rho)
                age = (latest - match.kickoff_at).total_seconds() / 86400
                weight = exp(-log(2) * age / half_life_days)
                loss -= weight * log(max(probability, 1e-12))
            loss += 100 * float(np.mean(attacks)) ** 2
            return loss

        initial = np.zeros(2 * len(teams) + 2)
        initial[-2], initial[-1] = 0.2, self.rho
        bounds = [(-2.5, 2.5)] * (2 * len(teams)) + [(-1, 1), (-0.3, 0.3)]
        result = minimize(objective, initial, method="L-BFGS-B", bounds=bounds)
        if not result.success:
            raise RuntimeError(f"Dixon-Coles fit failed: {result.message}")
        values = result.x
        self.rho = float(values[-1])
        self.parameters = DixonColesParameters({team: float(values[index[team]]) for team in teams}, {team: float(values[len(teams) + index[team]]) for team in teams}, float(values[-2]), self.rho, latest)
        return self.parameters

    def predict_teams(self, home_team: str, away_team: str) -> ScorePrediction:
        if self.parameters is None:
            raise RuntimeError("Dixon-Coles model is not fitted")
        try:
            home_xg = exp(self.parameters.home_advantage + self.parameters.attack[home_team] + self.parameters.defence[away_team])
            away_xg = exp(self.parameters.attack[away_team] + self.parameters.defence[home_team])
        except KeyError as error:
            raise ValueError(f"team was not present during fitting: {error.args[0]}") from error
        return self.predict(home_xg, away_xg)

    def predict(self, expected_home_goals: float, expected_away_goals: float) -> ScorePrediction:
        if expected_home_goals <= 0 or expected_away_goals <= 0:
            raise ValueError("expected goals must be positive")
        raw = []
        for home_goals in range(self.max_goals + 1):
            row = []
            for away_goals in range(self.max_goals + 1):
                probability = poisson_probability(home_goals, expected_home_goals) * poisson_probability(away_goals, expected_away_goals)
                probability *= dixon_coles_tau(home_goals, away_goals, expected_home_goals, expected_away_goals, self.rho)
                row.append(max(0.0, probability))
            raw.append(row)
        total = sum(map(sum, raw))
        matrix = tuple(tuple(value / total for value in row) for row in raw)
        home = sum(matrix[h][a] for h in range(len(matrix)) for a in range(len(matrix)) if h > a)
        draw = sum(matrix[g][g] for g in range(len(matrix)))
        away = 1.0 - home - draw
        over25 = sum(matrix[h][a] for h in range(len(matrix)) for a in range(len(matrix)) if h + a >= 3)
        return ScorePrediction(home, draw, away, over25, expected_home_goals, expected_away_goals, matrix)

    @staticmethod
    def expected_goals(
        league_home_average: float,
        league_away_average: float,
        home_scored: float,
        home_conceded: float,
        away_scored: float,
        away_conceded: float,
    ) -> tuple[float, float]:
        home_attack = home_scored / max(league_home_average, 0.1)
        away_defence = away_conceded / max(league_home_average, 0.1)
        away_attack = away_scored / max(league_away_average, 0.1)
        home_defence = home_conceded / max(league_away_average, 0.1)
        return max(0.05, league_home_average * home_attack * away_defence), max(0.05, league_away_average * away_attack * home_defence)
