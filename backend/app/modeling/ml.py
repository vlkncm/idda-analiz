from dataclasses import dataclass, field

import numpy as np
from lightgbm import LGBMClassifier


@dataclass(slots=True)
class MLProbabilityModels:
    random_state: int = 42
    result_model: LGBMClassifier = field(init=False)
    over25_model: LGBMClassifier = field(init=False)
    feature_names: list[str] = field(init=False, default_factory=list)

    def __post_init__(self) -> None:
        common = dict(
            n_estimators=160,
            learning_rate=0.04,
            num_leaves=15,
            min_child_samples=20,
            reg_lambda=1.0,
            random_state=self.random_state,
            verbosity=-1,
            n_jobs=1,
        )
        self.result_model = LGBMClassifier(objective="multiclass", **common)
        self.over25_model = LGBMClassifier(objective="binary", **common)

    def fit(self, features, results, overs, sample_weight=None) -> "MLProbabilityModels":
        self.feature_names = list(features.columns)
        self.result_model.fit(features, results, sample_weight=sample_weight)
        self.over25_model.fit(features, overs, sample_weight=sample_weight)
        return self

    def predict(self, features) -> tuple[np.ndarray, np.ndarray]:
        result = self.result_model.predict_proba(features)
        over = self.over25_model.predict_proba(features)[:, 1]
        return result, over

    def feature_importance(self) -> dict[str, float]:
        values = self.result_model.feature_importances_.astype(float)
        total = values.sum() or 1.0
        return dict(sorted(zip(self.feature_names, values / total), key=lambda item: item[1], reverse=True))
