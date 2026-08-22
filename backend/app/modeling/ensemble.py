from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from sklearn.metrics import log_loss


@dataclass(frozen=True, slots=True)
class EnsembleOutput:
    probabilities: tuple[float, float, float]
    confidence_score: float
    confidence: str
    agreement: float


class EnsembleModel:
    def __init__(self, weights: tuple[float, ...] = (0.40, 0.30, 0.20, 0.10)):
        self.weights = np.asarray(weights, dtype=float)
        self.weights /= self.weights.sum()

    def optimize(self, model_probabilities: list[np.ndarray], targets: np.ndarray) -> np.ndarray:
        def objective(weights):
            combined = sum(weight * values for weight, values in zip(weights, model_probabilities))
            one_hot = np.eye(3)[np.asarray(targets)]
            brier = np.mean(np.sum((combined - one_hot) ** 2, axis=1))
            return 0.7 * log_loss(targets, combined, labels=[0, 1, 2]) + 0.3 * brier

        result = minimize(
            objective,
            self.weights,
            method="SLSQP",
            bounds=[(0, 1)] * len(model_probabilities),
            constraints={"type": "eq", "fun": lambda weights: weights.sum() - 1},
        )
        if not result.success:
            raise RuntimeError(f"ensemble optimization failed: {result.message}")
        self.weights = result.x
        return self.weights.copy()

    def predict_one(self, ml, dixon_coles, elo, data_completeness: float = 1.0, calibration_quality: float = 1.0, market=None) -> EnsembleOutput:
        rows = [ml, dixon_coles, elo]
        weights = self.weights[:3]
        if market is not None and len(self.weights) >= 4:
            rows.append(market)
            weights = self.weights[:4]
        weights = weights / weights.sum()
        models = np.asarray(rows, dtype=float)
        combined = np.average(models, axis=0, weights=weights)
        winners = np.argmax(models, axis=1)
        agreement = float(np.max(np.bincount(winners, minlength=3)) / len(models))
        dispersion = float(np.mean(np.std(models, axis=0)))
        base = float(np.max(combined) * 100)
        ordered = np.sort(combined)
        margin = float(ordered[-1] - ordered[-2])
        score = max(0.0, min(100.0, base + 12 * agreement + 12 * margin - 35 * dispersion - 8 * (1 - data_completeness) - 10 * (1 - calibration_quality)))
        level = "LOW" if score < 55 else "MEDIUM" if score < 65 else "HIGH" if score < 75 else "VERY_HIGH"
        return EnsembleOutput(tuple(float(x) for x in combined), score, level, agreement)
