from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PromotionDecision:
    approved: bool
    reasons: tuple[str, ...]


def evaluate_promotion(candidate: dict[str, float], production: dict[str, float], minimum_matches: int = 500) -> PromotionDecision:
    reasons = []
    if candidate.get("total_matches", 0) < minimum_matches:
        reasons.append("insufficient walk-forward sample")
    for metric in ("log_loss", "brier_score", "calibration_error"):
        if candidate.get(metric, float("inf")) > production.get(metric, float("inf")):
            reasons.append(f"{metric} regressed")
    if candidate.get("draw_accuracy", 0) < production.get("draw_accuracy", 0) * 0.95:
        reasons.append("draw accuracy regressed by more than 5%")
    return PromotionDecision(not reasons, tuple(reasons))

