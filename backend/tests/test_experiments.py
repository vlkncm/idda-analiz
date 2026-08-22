from app.modeling.experiments import ExperimentRunner


def test_experiment_runner_selects_validation_objective() -> None:
    winner, results = ExperimentRunner().run(lambda config: {"log_loss": config.elo_k / 100, "brier_score": config.half_life_days / 1000, "calibration_error": config.form_window / 100})
    assert len(results) == 36
    assert winner.config.elo_k == 16
    assert winner.config.half_life_days == 180
