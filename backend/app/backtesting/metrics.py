import numpy as np
from sklearn.metrics import accuracy_score, brier_score_loss, confusion_matrix, f1_score, log_loss, precision_score, recall_score, roc_auc_score


def calibration_error(targets, probabilities, bins: int = 10) -> float:
    targets = np.asarray(targets)
    probabilities = np.asarray(probabilities)
    confidence = probabilities.max(axis=1)
    predictions = probabilities.argmax(axis=1)
    error = 0.0
    for lower in np.linspace(0, 1, bins, endpoint=False):
        mask = (confidence >= lower) & (confidence < lower + 1 / bins)
        if mask.any():
            error += mask.mean() * abs((predictions[mask] == targets[mask]).mean() - confidence[mask].mean())
    return float(error)


def calibration_curve(targets, probabilities, bins: int = 10) -> dict[str, list[dict]]:
    targets = np.asarray(targets)
    probabilities = np.asarray(probabilities)
    curves = {}
    for class_index, label in enumerate(("1", "X", "2")):
        points = []
        for lower in np.linspace(0, 1, bins, endpoint=False):
            mask = (probabilities[:, class_index] >= lower) & (probabilities[:, class_index] < lower + 1 / bins)
            if mask.any():
                points.append({"predicted": float(probabilities[mask, class_index].mean()), "observed": float((targets[mask] == class_index).mean()), "count": int(mask.sum())})
        curves[label] = points
    return curves


def multiclass_metrics(targets, probabilities) -> dict:
    probabilities = np.asarray(probabilities)
    predictions = probabilities.argmax(axis=1)
    one_hot = np.eye(3)[np.asarray(targets)]
    matrix = confusion_matrix(targets, predictions, labels=[0, 1, 2])
    recalls = np.diag(matrix) / np.maximum(matrix.sum(axis=1), 1)
    draw_truth = np.asarray(targets) == 1
    draw_prediction = predictions == 1
    return {
        "accuracy": float(accuracy_score(targets, predictions)),
        "log_loss": float(log_loss(targets, probabilities, labels=[0, 1, 2])),
        "brier_score": float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1))),
        "calibration_error": calibration_error(targets, probabilities),
        "calibration_curve": calibration_curve(targets, probabilities),
        "confusion_matrix": matrix.tolist(),
        "home_accuracy": float(recalls[0]),
        "home_precision": float(precision_score(targets, predictions, labels=[0], average="macro", zero_division=0)),
        "home_recall": float(recalls[0]),
        "draw_accuracy": float(recalls[1]),
        "draw_precision": float(precision_score(draw_truth, draw_prediction, zero_division=0)),
        "draw_recall": float(recall_score(draw_truth, draw_prediction, zero_division=0)),
        "draw_f1": float(f1_score(draw_truth, draw_prediction, zero_division=0)),
        "away_accuracy": float(recalls[2]),
        "away_precision": float(precision_score(targets, predictions, labels=[2], average="macro", zero_division=0)),
        "away_recall": float(recalls[2]),
        "probability_buckets": probability_buckets(targets, probabilities),
    }


def probability_buckets(targets, probabilities) -> dict[str, list[dict]]:
    targets = np.asarray(targets)
    probabilities = np.asarray(probabilities)
    output = {}
    for class_index, label in enumerate(("1", "X", "2")):
        rows = []
        for lower in np.arange(0, 1, .1):
            mask = (probabilities[:, class_index] >= lower) & (probabilities[:, class_index] < lower + .1)
            if mask.any():
                rows.append({"bucket": f"{int(lower*100)}-{int((lower+.1)*100)}", "predicted": float(probabilities[mask, class_index].mean()), "actual": float((targets[mask] == class_index).mean()), "count": int(mask.sum())})
        output[label] = rows
    return output


def binary_metrics(targets, probabilities, threshold: float = 0.5) -> dict:
    probabilities = np.asarray(probabilities)
    predictions = probabilities >= threshold
    return {
        "accuracy": float(accuracy_score(targets, predictions)),
        "precision": float(precision_score(targets, predictions, zero_division=0)),
        "recall": float(recall_score(targets, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(targets, probabilities)),
        "brier_score": float(brier_score_loss(targets, probabilities)),
        "log_loss": float(log_loss(targets, probabilities, labels=[0, 1])),
    }
