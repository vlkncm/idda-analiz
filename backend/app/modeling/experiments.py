from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Callable


@dataclass(frozen=True, slots=True)
class ExperimentConfig:
    elo_k: float
    half_life_days: float
    form_window: int
    ml_profile: str


@dataclass(frozen=True, slots=True)
class ExperimentResult:
    config: ExperimentConfig
    log_loss: float
    brier_score: float
    calibration_error: float

    @property
    def objective(self) -> float:
        return 0.6 * self.log_loss + 0.3 * self.brier_score + 0.1 * self.calibration_error


class ExperimentRunner:
    """Validation-only search. The held-out final test is never passed to the evaluator."""

    def configurations(self) -> list[ExperimentConfig]:
        return [ExperimentConfig(*values) for values in product((16.0, 24.0, 32.0), (180.0, 365.0, 730.0), (5, 10), ("baseline", "balanced"))]

    def run(self, validation_evaluator: Callable[[ExperimentConfig], dict[str, float]]) -> tuple[ExperimentResult, list[ExperimentResult]]:
        results = []
        for config in self.configurations():
            metrics = validation_evaluator(config)
            results.append(ExperimentResult(config, metrics["log_loss"], metrics["brier_score"], metrics["calibration_error"]))
        return min(results, key=lambda item: item.objective), results
