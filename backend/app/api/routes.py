from datetime import datetime, timezone
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, desc, func, select
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.backtesting.metrics import binary_metrics, multiclass_metrics
from app.models.football import League, Match, Season
from app.models.operational import BacktestRun, ModelMetric
from app.models.prediction import ModelVersion, Prediction
from app.core.config import get_settings
from app.modeling.artifact import PredictionArtifact
from app.services.prediction import PredictionService
from app.services.training import TrainingService
from app.models.operational import MatchTeamStats, OddsSnapshot
from app.providers.football_data_uk import FootballDataUkProvider
from app.services.free_data_sync import FreeDataSyncService
from app.services.automation import PredictionAutomationService

router = APIRouter(prefix="/api/v1")


class BacktestRequest(BaseModel):
    league_id: int
    model_version_id: int
    from_season: str
    to_season: str
    result_targets: list[int]
    result_probabilities: list[tuple[float, float, float]]
    over25_targets: list[int]
    over25_probabilities: list[float]

    @property
    def sample_size(self) -> int:
        return len(self.result_targets)


class RunPredictionRequest(BaseModel):
    model_version_id: int
    league_code: str
    features: dict[str, float]
    dixon_coles: tuple[float, float, float, float]
    elo: tuple[float, float, float]


class SyncRequest(BaseModel):
    history_seasons: int | None = Field(default=None, ge=1, le=20)


class TrainRequest(BaseModel):
    version: str | None = Field(default=None, pattern=r"^v[0-9][A-Za-z0-9._-]*$")


@router.get("/leagues")
def leagues(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(League).where(League.is_active.is_(True)).order_by(League.name)).all()
    return [{"id": row.id, "code": row.code, "name": row.name, "country_code": row.country_code} for row in rows]


@router.get("/seasons")
def seasons(league_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(Season).order_by(desc(Season.start_date))
    if league_id is not None:
        query = query.where(Season.league_id == league_id)
    return [{"id": row.id, "league_id": row.league_id, "name": row.name, "start_date": row.start_date, "end_date": row.end_date, "is_current": row.is_current} for row in db.scalars(query).all()]


def _match_response(row: Match) -> dict:
    return {"id": row.id, "league_id": row.league_id, "season_id": row.season_id, "home_team": row.home_team.name, "away_team": row.away_team.name, "kickoff_at": row.kickoff_at, "status": row.status, "home_score": row.home_goals, "away_score": row.away_goals}


@router.get("/matches")
def matches(
    league_code: str | None = None,
    upcoming_only: bool = True,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(Match).options(joinedload(Match.home_team), joinedload(Match.away_team), joinedload(Match.season).joinedload(Season.league))
    if upcoming_only:
        query = query.where(Match.kickoff_at >= datetime.now(timezone.utc))
    if league_code:
        query = query.join(Match.season).join(League).where(League.code == league_code)
    rows = db.scalars(query.order_by(Match.kickoff_at).limit(limit)).unique().all()
    return [{"id": row.id, "league": row.season.league.code, "home_team": row.home_team.name, "away_team": row.away_team.name, "kickoff_at": row.kickoff_at, "status": row.status} for row in rows]


@router.get("/matches/upcoming")
def upcoming_matches(league_id: int | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)) -> list[dict]:
    query = select(Match).options(joinedload(Match.home_team), joinedload(Match.away_team)).where(Match.kickoff_at >= datetime.now(timezone.utc)).order_by(Match.kickoff_at).limit(limit)
    if league_id is not None:
        query = query.where(Match.league_id == league_id)
    return [_match_response(row) for row in db.scalars(query).unique().all()]


@router.get("/matches/{match_id}")
def match_detail(match_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(Match).options(joinedload(Match.home_team), joinedload(Match.away_team)).where(Match.id == match_id))
    if row is None:
        raise HTTPException(404, "match not found")
    return _match_response(row)


@router.get("/matches/{match_id}/prediction")
def match_prediction(match_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(Prediction).where(Prediction.match_id == match_id).order_by(desc(Prediction.prediction_timestamp)))
    if row is None:
        raise HTTPException(404, "prediction not found")
    return {"match_id": row.match_id, "model_version_id": row.model_version_id, "created_at": row.prediction_timestamp, "home_probability": row.home_probability, "draw_probability": row.draw_probability, "away_probability": row.away_probability, "over25_probability": row.over25_probability, "predicted_result": row.predicted_result, "confidence": row.confidence, "confidence_score": row.confidence_score, "model_agreement": row.model_agreement, "model_outputs": row.model_outputs, "explanation": row.explanation, "feature_snapshot": row.feature_snapshot, "actual_result": row.actual_result, "actual_over25": row.actual_over25}


@router.get("/predictions")
def predictions(league_code: str | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)) -> list[dict]:
    query = select(Prediction).join(Prediction.match).options(joinedload(Prediction.match).joinedload(Match.home_team), joinedload(Prediction.match).joinedload(Match.away_team))
    if league_code:
        query = query.join(Match.season).join(League).where(League.code == league_code)
    rows = db.scalars(query.order_by(desc(Prediction.prediction_timestamp)).limit(limit)).unique().all()
    return [{"match_id": row.match_id, "home_team": row.match.home_team.name, "away_team": row.match.away_team.name, "kickoff_at": row.kickoff_at, "1": row.home_probability, "X": row.draw_probability, "2": row.away_probability, "over25": row.over25_probability, "confidence": row.confidence, "model_version_id": row.model_version_id} for row in rows]


@router.post("/matches/{match_id}/predict", status_code=201)
def run_prediction(match_id: int, payload: RunPredictionRequest, db: Session = Depends(get_db)) -> dict:
    match = db.get(Match, match_id)
    version = db.get(ModelVersion, payload.model_version_id)
    if match is None or version is None:
        raise HTTPException(404, "match or model version not found")
    artifact_path = __import__("pathlib").Path(get_settings().artifact_dir) / f"{payload.league_code}-{version.version}.joblib"
    if not artifact_path.exists():
        raise HTTPException(409, "trained model artifact is not available")
    try:
        prediction, reasons = PredictionService(db).predict_and_store(match, version, PredictionArtifact.load(artifact_path), payload.features, payload.dixon_coles, payload.elo)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {"match_id": match.id, "1": prediction.home_probability, "X": prediction.draw_probability, "2": prediction.away_probability, "over25": prediction.over25_probability, "confidence": prediction.confidence, "confidence_score": prediction.confidence_score, "reasons": reasons, "warning": "Olasılıklar kesin sonuç veya kazanç garantisi değildir."}


@router.post("/backtests", status_code=201)
def create_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict:
    lengths = {len(payload.result_targets), len(payload.result_probabilities), len(payload.over25_targets), len(payload.over25_probabilities)}
    if len(lengths) != 1 or payload.sample_size == 0:
        raise HTTPException(422, "all backtest arrays must have the same non-zero length")
    if db.get(League, payload.league_id) is None or db.get(ModelVersion, payload.model_version_id) is None:
        raise HTTPException(404, "league or model version not found")
    metrics = {"total_matches": payload.sample_size, "result": multiclass_metrics(payload.result_targets, payload.result_probabilities), "over25": binary_metrics(payload.over25_targets, payload.over25_probabilities)}
    run = BacktestRun(league_id=payload.league_id, model_version_id=payload.model_version_id, from_season=payload.from_season, to_season=payload.to_season, status="completed", metrics=metrics)
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"id": run.id, **metrics}


@router.get("/admin/performance")
def performance(league_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(ModelMetric).order_by(desc(ModelMetric.evaluated_at))
    if league_id is not None:
        query = query.where(ModelMetric.league_id == league_id)
    return [{"league_id": row.league_id, "model_version_id": row.model_version_id, "evaluated_at": row.evaluated_at, "sample_size": row.sample_size, "metrics": row.metrics, "feature_importance": row.feature_importance} for row in db.scalars(query).all()]


@router.get("/model/current")
@router.get("/models/current")
def current_model(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(ModelVersion).where(ModelVersion.is_production.is_(True)).order_by(desc(ModelVersion.created_at)))
    if row is None:
        raise HTTPException(404, "production model is not configured")
    return {"id": row.id, "version": row.version, "training_start": row.training_start, "training_end": row.training_end, "features": row.features, "hyperparameters": row.hyperparameters, "metrics": row.metrics, "created_at": row.created_at}


@router.get("/model/metrics")
@router.get("/models/metrics")
def model_metrics(league_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    return performance(league_id, db)


@router.post("/admin/sync")
def admin_sync(payload: SyncRequest, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    try:
        report = FreeDataSyncService(db, FootballDataUkProvider(settings.football_data_uk_base_url), payload.history_seasons or settings.history_seasons).sync()
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    return asdict(report)


@router.post("/admin/predict")
def admin_predict(db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    return PredictionAutomationService(db, settings.artifact_dir, settings.feature_half_life_days, settings.elo_initial_rating, settings.elo_k_factor).predict_upcoming()


@router.get("/admin/data-quality")
def data_quality(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        select(
            League.code,
            func.count(func.distinct(Match.id)),
            func.count(func.distinct(case((OddsSnapshot.id.is_not(None), Match.id)))),
            func.count(func.distinct(case((MatchTeamStats.shots.is_not(None), Match.id)))),
            func.count(func.distinct(case((MatchTeamStats.shots_on_target.is_not(None), Match.id)))),
        ).join(Match, Match.league_id == League.id).outerjoin(OddsSnapshot, OddsSnapshot.match_id == Match.id).outerjoin(MatchTeamStats, MatchTeamStats.match_id == Match.id).group_by(League.code)
    ).all()
    return [{"league": code, "matches": matches, "with_odds": odds, "with_shots": shots, "with_shots_on_target": sot, "missing_odds": matches - odds, "missing_shots": matches - shots, "missing_shots_on_target": matches - sot} for code, matches, odds, shots, sot in rows]


@router.post("/admin/train", status_code=201)
def admin_train(payload: TrainRequest, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    version = payload.version or datetime.now(timezone.utc).strftime("v%Y.%m.%d.%H%M")
    try:
        return TrainingService(db, settings.artifact_dir, settings.feature_half_life_days).train(version)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/admin/backtest", status_code=201)
def admin_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict:
    return create_backtest(payload, db)


@router.get("/admin/model-versions")
def model_versions(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(ModelVersion).order_by(desc(ModelVersion.created_at))).all()
    return [{"id": row.id, "version": row.version, "description": row.description, "is_production": row.is_production, "created_at": row.created_at} for row in rows]


@router.get("/admin/backtests")
def backtests(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(BacktestRun).order_by(desc(BacktestRun.created_at)).limit(100)).all()
    return [{"id": row.id, "league_id": row.league_id, "model_version_id": row.model_version_id, "from_season": row.from_season, "to_season": row.to_season, "status": row.status, "metrics": row.metrics} for row in rows]


@router.get("/admin/wrong-predictions")
def wrong_predictions(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Prediction).where(Prediction.actual_result.is_not(None), Prediction.actual_result != Prediction.predicted_result).order_by(desc(Prediction.kickoff_at)).limit(100)).all()
    return [{"match_id": row.match_id, "predicted": row.predicted_result, "actual": row.actual_result, "confidence": row.confidence, "kickoff_at": row.kickoff_at} for row in rows]
