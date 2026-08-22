from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from app.backtesting.metrics import binary_metrics, multiclass_metrics
from app.backtesting.walk_forward import WalkForwardSplit
from app.features.builder import FeatureBuilder, HistoricalMatch, MatchContext
from app.features.squad import PlayerAvailability, squad_absence_impact
from app.modeling.calibration import ProbabilityCalibrator
from app.modeling.dixon_coles import DixonColesEngine, DixonColesMatch
from app.modeling.elo import EloEngine, EloMatch, EloThreeWayCalibrator
from app.modeling.ensemble import EnsembleModel
from app.modeling.market import remove_vig
from app.modeling.ml import MLProbabilityModels
from app.modeling.artifact import PredictionArtifact, fit_artifact
from app.modeling.training import WalkForwardTrainer
from app.monitoring.promotion import evaluate_promotion


def test_elo_is_league_scoped_and_updates_chronologically() -> None:
    elo = EloEngine(home_advantages={"TR-SL": 90, "EN-PL": 55})
    before = elo.predict("TR-SL", "GS", "BJK")
    elo.update("TR-SL", "GS", "BJK", 3, 0)
    after = elo.predict("TR-SL", "GS", "BJK")
    assert after.home > before.home
    assert elo.rating("EN-PL", "GS") == 1500
    assert abs(sum((after.home, after.draw, after.away)) - 1) < 1e-12


def test_elo_history_stores_pre_match_values_without_future_leakage() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    matches = [EloMatch(start + timedelta(days=index), "TR-SL", "A", "B", 1, 0) for index in range(3)]
    snapshots = EloEngine().process_history(list(reversed(matches)))
    assert snapshots[0].home_rating == snapshots[0].away_rating == 1500
    assert snapshots[1].home_rating > snapshots[1].away_rating
    calibrator = EloThreeWayCalibrator().fit("TR-SL", [-200, -100, 0, 0, 100, 200], [2, 2, 1, 1, 0, 0])
    probabilities = calibrator.predict("TR-SL", 120)
    assert abs(probabilities.home + probabilities.draw + probabilities.away - 1) < 1e-12


def test_dixon_coles_matrix_and_over25_are_normalized() -> None:
    prediction = DixonColesEngine(max_goals=8).predict(1.8, 1.1)
    assert len(prediction.matrix) == 9
    assert abs(sum(map(sum, prediction.matrix)) - 1) < 1e-12
    assert abs(prediction.home + prediction.draw + prediction.away - 1) < 1e-12
    assert 0 < prediction.over25 < 1


def test_dixon_coles_fits_attack_defence_with_recency() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    history = [DixonColesMatch(start + timedelta(days=index * 7), "A" if index % 2 == 0 else "B", "B" if index % 2 == 0 else "A", 2 if index % 3 else 1, index % 2) for index in range(24)]
    model = DixonColesEngine(max_goals=7)
    params = model.fit(history, half_life_days=120)
    prediction = model.predict_teams("A", "B")
    assert params.fitted_until == history[-1].kickoff_at
    assert len(prediction.matrix) == 8


def test_point_in_time_features_ignore_future_matches() -> None:
    kickoff = datetime(2026, 8, 22, tzinfo=timezone.utc)
    history = [
        HistoricalMatch(kickoff - timedelta(days=7), "A", "B", 2, 0, 1.7, 0.4),
        HistoricalMatch(kickoff + timedelta(days=1), "A", "B", 0, 9, 0.1, 7.0),
    ]
    context = MatchContext(league_id=1, home_coach_changed_at=kickoff - timedelta(days=10), odds=(2.0, 3.5, 4.0, 1.8))
    features = FeatureBuilder().build("A", "B", kickoff, history, {"A": 1600, "B": 1450}, context)
    assert features["home_form_5_goals_for"] == 2
    assert features["away_form_5_goals_for"] == 0
    assert features["elo_difference"] == 150
    assert features["home_coach_changed"] == 1
    assert features["market_data_missing"] == 0
    assert features["home_last5_points_per_game"] == features["home_form_5_ppm"]
    assert "h2h_matches" not in features


def test_squad_module_is_optional_and_importance_weighted() -> None:
    assert squad_absence_impact(None) is None
    impact = squad_absence_impact([PlayerAvailability("9", "striker", False, minutes=1800, starts=20, team_matches=24, goals=15, xg=12, is_top_scorer=True)])
    assert impact is not None and impact > 1


def test_market_vig_is_removed() -> None:
    probabilities = remove_vig(2.0, 3.5, 4.0)
    assert abs(sum(probabilities) - 1) < 1e-12


def test_ml_calibration_ensemble_backtest_and_promotion() -> None:
    rng = np.random.default_rng(42)
    features = pd.DataFrame(rng.normal(size=(90, 4)), columns=["elo", "xg", "rest", "league"])
    results = np.tile([0, 1, 2], 30)
    overs = np.tile([0, 1], 45)
    ml = MLProbabilityModels().fit(features, results, overs)
    result_probabilities, over_probabilities = ml.predict(features)
    assert result_probabilities.shape == (90, 3)
    calibrated = ProbabilityCalibrator("platt").fit(result_probabilities, results).transform(result_probabilities)
    assert np.allclose(calibrated.sum(axis=1), 1)
    ensemble = EnsembleModel()
    output = ensemble.predict_one(calibrated[0], [0.4, 0.3, 0.3], [0.42, 0.28, 0.30])
    assert abs(sum(output.probabilities) - 1) < 1e-12
    assert output.confidence in {"LOW", "MEDIUM", "HIGH", "VERY_HIGH"}
    assert multiclass_metrics(results, calibrated)["confusion_matrix"]
    assert binary_metrics(overs, over_probabilities)["brier_score"] >= 0
    folds = WalkForwardSplit(2).split([2019, 2019, 2020, 2021, 2022])
    assert len(folds) == 1 and len(folds[0].test) == 1
    decision = evaluate_promotion(
        {"total_matches": 600, "log_loss": .8, "brier_score": .5, "calibration_error": .03, "draw_accuracy": .3},
        {"log_loss": .9, "brier_score": .6, "calibration_error": .04, "draw_accuracy": .3},
    )
    assert decision.approved


def test_walk_forward_training_uses_future_test_fold_only_once() -> None:
    rng = np.random.default_rng(7)
    rows = []
    start = pd.Timestamp("2019-08-01", tz="UTC")
    for season_index, season in enumerate(["2019", "2020", "2021", "2022", "2023"]):
        for index in range(30):
            result = index % 3
            dc = np.full(3, .2)
            dc[result] = .6
            elo = np.array([.42, .28, .30])
            rows.append({"season": season, "kickoff_at": start + pd.Timedelta(days=season_index * 365 + index), "signal": result + rng.normal(0, .2), "league_id": 1, "elo_difference": (result - 1) * -100, "dc_home": dc[0], "dc_draw": dc[1], "dc_away": dc[2], "elo_home": elo[0], "elo_draw": elo[1], "elo_away": elo[2], "result_target": result, "over25_target": index % 2})
    reports = WalkForwardTrainer(minimum_train_seasons=2).run(pd.DataFrame(rows))
    assert len(reports) == 2
    assert reports[-1].test_season == "2023"
    assert abs(sum(reports[-1].weights) - 1) < 1e-6


def test_deployable_artifact_round_trip(tmp_path) -> None:
    rng = np.random.default_rng(11)
    def frame(size: int):
        result = np.arange(size) % 3
        return pd.DataFrame({"elo_difference": rng.normal(size=size), "xg_difference": rng.normal(size=size), "result_target": result, "over25_target": np.arange(size) % 2, "dc_home": np.where(result == 0, .55, np.where(result == 1, .25, .23)), "dc_draw": np.where(result == 1, .50, .22), "dc_away": np.where(result == 2, .55, np.where(result == 1, .25, .23)), "elo_home": .42, "elo_draw": .28, "elo_away": .30})
    artifact = fit_artifact("v1.0", "TR-SL", frame(90), frame(30), ["elo_difference", "xg_difference"])
    path = artifact.save(tmp_path)
    loaded = PredictionArtifact.load(path)
    output = loaded.predict({"elo_difference": 120, "xg_difference": .4, "xg_missing": 0}, (.52, .26, .22, .61), (.48, .29, .23))
    assert abs(output["home"] + output["draw"] + output["away"] - 1) < 1e-9
    assert 0 <= output["over25"] <= 1
