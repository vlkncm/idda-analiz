from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.football import League, Match, Season, Team
from app.models.prediction import ConfidenceLevel, ModelVersion, Prediction, ResultCode
from app.schemas.match import MatchCreate
from app.schemas.prediction import PredictionCreate
from app.services.settlement import settle_match


def match_graph(session: Session) -> tuple[Match, ModelVersion]:
    league = League(code="TR-SL", name="Türkiye Süper Lig", country_code="TR", timezone="Europe/Istanbul")
    season = Season(league=league, name="2026-27", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31))
    home = Team(code="TR-GS", name="Galatasaray", country_code="TR")
    away = Team(code="TR-BJK", name="Beşiktaş", country_code="TR")
    match = Match(
        league=league,
        season=season,
        home_team=home,
        away_team=away,
        kickoff_at=datetime(2026, 9, 1, 17, tzinfo=timezone.utc),
        provider="csv",
        external_id="2026-gs-bjk",
    )
    model = ModelVersion(version="v1.0", is_production=False)
    session.add_all([match, model])
    session.commit()
    return match, model


def test_core_match_graph_is_persisted(session: Session) -> None:
    match, _ = match_graph(session)
    assert match.season.league.code == "TR-SL"
    assert match.home_team.name == "Galatasaray"
    assert match.away_team.name == "Beşiktaş"


def test_provider_match_identity_is_unique(session: Session) -> None:
    match, _ = match_graph(session)
    duplicate = Match(
        league_id=match.league_id,
        season_id=match.season_id,
        home_team_id=match.home_team_id,
        away_team_id=match.away_team_id,
        kickoff_at=match.kickoff_at,
        provider=match.provider,
        external_id=match.external_id,
    )
    session.add(duplicate)
    with pytest.raises(IntegrityError):
        session.commit()


def test_partial_or_negative_score_is_rejected(session: Session) -> None:
    match, _ = match_graph(session)
    match.home_goals = 2
    match.away_goals = None
    with pytest.raises(IntegrityError):
        session.commit()


def test_prediction_schema_rejects_leakage_and_bad_probability_sum() -> None:
    kickoff = datetime.now(timezone.utc) + timedelta(days=1)
    base = {
        "match_id": 1,
        "model_version_id": 1,
        "prediction_timestamp": kickoff - timedelta(hours=1),
        "kickoff_at": kickoff,
        "home_probability": 0.54,
        "draw_probability": 0.26,
        "away_probability": 0.20,
        "over25_probability": 0.61,
        "confidence_score": 68,
        "confidence": "HIGH",
        "predicted_result": "1",
    }
    assert PredictionCreate(**base).predicted_result is ResultCode.HOME
    with pytest.raises(ValidationError, match="sum to 1"):
        PredictionCreate(**{**base, "away_probability": 0.30})
    with pytest.raises(ValidationError, match="before kickoff"):
        PredictionCreate(**{**base, "prediction_timestamp": kickoff})


def test_prediction_is_saved_before_kickoff(session: Session) -> None:
    match, model = match_graph(session)
    prediction = Prediction(
        match_id=match.id,
        model_version_id=model.id,
        prediction_timestamp=match.kickoff_at - timedelta(hours=2),
        kickoff_at=match.kickoff_at,
        home_probability=0.538,
        draw_probability=0.257,
        away_probability=0.205,
        over25_probability=0.621,
        confidence_score=64.0,
        confidence=ConfidenceLevel.MEDIUM,
        predicted_result=ResultCode.HOME,
    )
    session.add(prediction)
    session.commit()
    assert prediction.actual_result is None
    assert prediction.actual_total_goals is None


def test_settlement_adds_actuals_without_rewriting_probabilities(session: Session) -> None:
    match, model = match_graph(session)
    prediction = Prediction(match_id=match.id, model_version_id=model.id, prediction_timestamp=match.kickoff_at - timedelta(hours=2), kickoff_at=match.kickoff_at, home_probability=.5, draw_probability=.3, away_probability=.2, over25_probability=.55, confidence_score=62, confidence=ConfidenceLevel.MEDIUM, predicted_result=ResultCode.HOME)
    session.add(prediction)
    session.commit()
    before = (prediction.home_probability, prediction.draw_probability, prediction.away_probability)
    assert settle_match(session, match, 1, 1) == 1
    assert prediction.actual_result is ResultCode.DRAW
    assert prediction.actual_total_goals == 2
    assert (prediction.home_probability, prediction.draw_probability, prediction.away_probability) == before


def test_prediction_feature_snapshot_is_immutable(session: Session) -> None:
    match, model = match_graph(session)
    prediction = Prediction(match_id=match.id, model_version_id=model.id, prediction_timestamp=match.kickoff_at - timedelta(hours=2), kickoff_at=match.kickoff_at, home_probability=.5, draw_probability=.3, away_probability=.2, over25_probability=.55, confidence_score=62, confidence=ConfidenceLevel.MEDIUM, predicted_result=ResultCode.HOME, feature_snapshot={"home_elo": 1600})
    session.add(prediction)
    session.commit()
    prediction.feature_snapshot["home_elo"] = 1700
    with pytest.raises(ValueError, match="immutable"):
        session.commit()


def test_match_schema_requires_timezone_and_distinct_teams() -> None:
    data = {
        "season_id": 1,
        "home_team_id": 7,
        "away_team_id": 7,
        "kickoff_at": datetime(2026, 9, 1, 20),
        "provider": "csv",
        "external_id": "fixture-1",
    }
    with pytest.raises(ValidationError, match="must differ"):
        MatchCreate(**data)
    with pytest.raises(ValidationError, match="timezone"):
        MatchCreate(**{**data, "away_team_id": 8})
