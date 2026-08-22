from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.main import app
from app.models.football import League, Match, Season, Team
from app.models.prediction import ConfidenceLevel, ModelVersion, Prediction, ResultCode


def test_health_and_league_api(session: Session) -> None:
    session.add(League(code="EN-PL", name="Premier League", country_code="GB", timezone="Europe/London"))
    session.commit()

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        assert client.get("/health").json() == {"status": "ok", "phase": "22"}
        response = client.get("/api/v1/leagues")
        assert response.status_code == 200
        assert response.json()[0]["code"] == "EN-PL"
        openapi = client.get("/openapi.json").json()
        expected = {"/api/v1/leagues", "/api/v1/seasons", "/api/v1/matches", "/api/v1/matches/upcoming", "/api/v1/matches/{match_id}", "/api/v1/matches/{match_id}/prediction", "/api/v1/predictions", "/api/v1/models/current", "/api/v1/models/metrics", "/api/v1/admin/sync", "/api/v1/admin/train", "/api/v1/admin/backtest", "/api/v1/admin/predict", "/api/v1/admin/data-quality"}
        assert expected.issubset(openapi["paths"])
    finally:
        app.dependency_overrides.clear()


def test_match_and_prediction_endpoints(session: Session) -> None:
    league = League(code="TR-SL", name="Süper Lig", country_code="TR", timezone="Europe/Istanbul")
    season = Season(league=league, name="2026/2027", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31), is_current=True)
    home = Team(code="h", name="Home", country_code="TR")
    away = Team(code="a", name="Away", country_code="TR")
    match = Match(league=league, season=season, home_team=home, away_team=away, kickoff_at=datetime.now(timezone.utc) + timedelta(days=1), provider="test", external_id="m1")
    model = ModelVersion(version="v1.0.0", is_production=True)
    session.add_all([match, model])
    session.commit()
    prediction = Prediction(match_id=match.id, model_version_id=model.id, prediction_timestamp=datetime.now(timezone.utc), kickoff_at=match.kickoff_at, home_probability=.5, draw_probability=.3, away_probability=.2, over25_probability=.6, confidence_score=66, confidence=ConfidenceLevel.HIGH, predicted_result=ResultCode.HOME, feature_snapshot={"home_elo": 1600}, explanation=["Home Elo advantage +100"], model_agreement=1.0)
    session.add(prediction)
    session.commit()

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        assert client.get("/api/v1/matches/upcoming").json()[0]["id"] == match.id
        assert client.get(f"/api/v1/matches/{match.id}").json()["home_team"] == "Home"
        detail = client.get(f"/api/v1/matches/{match.id}/prediction").json()
        assert detail["model_agreement"] == 1.0
        assert abs(detail["home_probability"] + detail["draw_probability"] + detail["away_probability"] - 1) < 1e-12
        assert client.get("/api/v1/model/current").json()["version"] == "v1.0.0"
    finally:
        app.dependency_overrides.clear()
