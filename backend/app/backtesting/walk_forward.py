from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class Fold:
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray


class WalkForwardSplit:
    def __init__(self, minimum_train_seasons: int = 3):
        self.minimum_train_seasons = minimum_train_seasons

    def split(self, seasons) -> list[Fold]:
        values = np.asarray(seasons)
        unique = np.array(sorted(set(values)))
        folds = []
        for index in range(self.minimum_train_seasons, len(unique) - 1):
            train_seasons = unique[:index]
            validation_season = unique[index]
            test_season = unique[index + 1]
            folds.append(
                Fold(
                    np.flatnonzero(np.isin(values, train_seasons)),
                    np.flatnonzero(values == validation_season),
                    np.flatnonzero(values == test_season),
                )
            )
        return folds

