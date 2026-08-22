import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


class ProbabilityCalibrator:
    def __init__(self, method: str = "auto"):
        if method not in {"auto", "isotonic", "platt"}:
            raise ValueError("method must be auto, isotonic or platt")
        self.method = method
        self.models: list = []

    def fit(self, probabilities, targets) -> "ProbabilityCalibrator":
        values = np.asarray(probabilities, dtype=float)
        labels = np.asarray(targets)
        if values.ndim == 1:
            values = values[:, None]
        self.models = []
        chosen = "isotonic" if self.method == "auto" and len(labels) >= 1000 else "platt" if self.method == "auto" else self.method
        for column in range(values.shape[1]):
            binary = (labels == column).astype(int) if values.shape[1] > 1 else labels.astype(int)
            if chosen == "isotonic":
                model = IsotonicRegression(out_of_bounds="clip").fit(values[:, column], binary)
            else:
                model = LogisticRegression().fit(values[:, [column]], binary)
            self.models.append(model)
        return self

    def transform(self, probabilities):
        values = np.asarray(probabilities, dtype=float)
        one_dimensional = values.ndim == 1
        if one_dimensional:
            values = values[:, None]
        calibrated = []
        for column, model in enumerate(self.models):
            if isinstance(model, IsotonicRegression):
                calibrated.append(model.predict(values[:, column]))
            else:
                calibrated.append(model.predict_proba(values[:, [column]])[:, 1])
        output = np.column_stack(calibrated)
        if output.shape[1] > 1:
            output = output / np.maximum(output.sum(axis=1, keepdims=True), 1e-12)
        return output[:, 0] if one_dimensional else output

