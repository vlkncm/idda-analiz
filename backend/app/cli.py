import argparse
import json
from dataclasses import asdict
from datetime import date
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import create_session_factory
from app.modeling.artifact import fit_artifact
from app.models.football import League, Season
from app.models.prediction import ModelVersion
from app.providers.csv_provider import CsvDataProvider
from app.services.ingestion import IngestionService
from app.providers.sportmonks import ProviderConfigurationError, SportmonksProvider
from app.services.automation import PredictionAutomationService
from app.services.dataset import TrainingDatasetBuilder
from app.services.sportmonks_sync import DatabaseResponseCache, SportmonksSyncService
from app.services.training import TrainingService
from app.providers.football_data_uk import FootballDataUkProvider
from app.services.free_data_sync import FreeDataSyncService
from app.modeling.training import WalkForwardTrainer
from app.models.football import Match
from app.models.prediction import Prediction


def ingest_csv(args) -> None:
    with create_session_factory()() as db:
        league = db.scalar(select(League).where(League.code == args.league))
        if league is None:
            raise SystemExit(f"unknown league code: {args.league}; run Alembic migrations first")
        season = db.scalar(select(Season).where(Season.league_id == league.id, Season.name == args.season))
        if season is None:
            season = Season(league_id=league.id, name=args.season, start_date=date.fromisoformat(args.start_date), end_date=date.fromisoformat(args.end_date))
            db.add(season)
            db.commit()
            db.refresh(season)
        count = IngestionService(db).ingest(CsvDataProvider(args.file), season)
        print(f"{count} match rows ingested for {args.league} {args.season}")


def train_artifact(args) -> None:
    if args.file is None:
        settings = get_settings()
        version = args.version or datetime.now(timezone.utc).strftime("v%Y.%m.%d.%H%M")
        with create_session_factory()() as db:
            result = TrainingService(db, args.artifact_dir or settings.artifact_dir, settings.feature_half_life_days).train(version)
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return
    if not args.league or not args.version:
        raise SystemExit("--file kullanıldığında --league ve --version zorunludur")
    frame = pd.read_csv(args.file, parse_dates=["kickoff_at"])
    required = {"season", "kickoff_at", "result_target", "over25_target", "dc_home", "dc_draw", "dc_away", "elo_home", "elo_draw", "elo_away"}
    missing = required.difference(frame.columns)
    if missing:
        raise SystemExit(f"training CSV is missing columns: {', '.join(sorted(missing))}")
    seasons = sorted(frame["season"].astype(str).unique())
    if len(seasons) < 2:
        raise SystemExit("at least two chronological seasons are required for train/validation")
    frame["season"] = frame["season"].astype(str)
    validation = frame[frame["season"] == seasons[-1]]
    train = frame[frame["season"] != seasons[-1]]
    excluded = required | {"sample_weight"}
    features = [name for name in frame.columns if name not in excluded]
    numeric_features = [name for name in features if pd.api.types.is_numeric_dtype(frame[name])]
    artifact = fit_artifact(args.version, args.league, train, validation, numeric_features)
    path = artifact.save(args.artifact_dir or get_settings().artifact_dir)
    with create_session_factory()() as db:
        version = db.scalar(select(ModelVersion).where(ModelVersion.version == args.version))
        if version is None:
            db.add(ModelVersion(version=args.version, description=f"{args.league} artifact; validation season {seasons[-1]}", is_production=False))
            db.commit()
    print(f"artifact saved: {path}")


def sync_sportmonks(args) -> None:
    settings = get_settings()
    with create_session_factory()() as db:
        cache = DatabaseResponseCache(db)
        provider = SportmonksProvider(settings.sportmonks_api_key, settings.sportmonks_base_url, settings.sportmonks_timeout_seconds, settings.sportmonks_max_retries, cache_get=cache.get, cache_set=cache.set)
        report = SportmonksSyncService(db, provider, args.history_seasons or settings.history_seasons).sync()
        print(json.dumps({name: getattr(report, name) for name in report.__slots__}, indent=2))


def sync_free(args) -> None:
    settings = get_settings()
    with create_session_factory()() as db:
        provider = FootballDataUkProvider(settings.football_data_uk_base_url)
        report = FreeDataSyncService(db, provider, args.history_seasons or settings.history_seasons).sync()
        print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def bootstrap(args) -> None:
    sync_free(args)
    settings = get_settings()
    version = datetime.now(timezone.utc).strftime("v%Y.%m.%d.%H%M")
    with create_session_factory()() as db:
        trained = TrainingService(db, settings.artifact_dir, settings.feature_half_life_days).train(version)
    print(json.dumps({"training": trained}, ensure_ascii=False, indent=2, default=str))
    predict_upcoming(args)


def run_backtest(args) -> None:
    settings = get_settings()
    with create_session_factory()() as db:
        league = db.scalar(select(League).where(League.code == args.league))
        if league is None:
            raise SystemExit(f"unknown league: {args.league}")
        frame = TrainingDatasetBuilder(db, settings.feature_half_life_days).build(league)
        if frame.empty or "kickoff_at" not in frame.columns:
            print(json.dumps({"league": args.league, "status": "insufficient_data", "matches": 0, "reports": []}, ensure_ascii=False, indent=2))
            return
        reports = WalkForwardTrainer(settings.feature_half_life_days, args.minimum_train_seasons).run(frame)
        print(json.dumps([asdict(report) for report in reports], ensure_ascii=False, indent=2, default=str))


def predict_upcoming(args) -> None:
    settings = get_settings()
    with create_session_factory()() as db:
        result = PredictionAutomationService(db, settings.artifact_dir, settings.feature_half_life_days, settings.elo_initial_rating, settings.elo_k_factor).predict_upcoming()
        print(json.dumps(result, indent=2))


def show_status(args) -> None:
    with create_session_factory()() as db:
        current = db.scalar(select(ModelVersion).where(ModelVersion.is_production.is_(True)).order_by(ModelVersion.created_at.desc()))
        output = {"matches": db.scalar(select(func.count()).select_from(Match)), "predictions": db.scalar(select(func.count()).select_from(Prediction)), "production_model": current.version if current else None, "free_csv_provider": True, "football_data_org_key_configured": bool(get_settings().football_data_api_key), "sportmonks_key_configured": bool(get_settings().sportmonks_api_key)}
        print(json.dumps(output, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="IDDA data and model operations")
    commands = parser.add_subparsers(required=True)
    sync = commands.add_parser("sync")
    sync.add_argument("--history-seasons", type=int)
    sync.add_argument("--provider", choices=("free", "sportmonks"), default="free")
    sync.set_defaults(handler=lambda args: sync_sportmonks(args) if args.provider == "sportmonks" else sync_free(args))
    boot = commands.add_parser("bootstrap")
    boot.add_argument("--history-seasons", type=int)
    boot.set_defaults(handler=bootstrap)
    ingest = commands.add_parser("ingest-csv")
    ingest.add_argument("--file", type=Path, required=True)
    ingest.add_argument("--league", required=True)
    ingest.add_argument("--season", required=True)
    ingest.add_argument("--start-date", required=True)
    ingest.add_argument("--end-date", required=True)
    ingest.set_defaults(handler=ingest_csv)
    train = commands.add_parser("train")
    train.add_argument("--file", type=Path)
    train.add_argument("--league")
    train.add_argument("--version")
    train.add_argument("--artifact-dir", type=Path)
    train.set_defaults(handler=train_artifact)
    backtest = commands.add_parser("backtest")
    backtest.add_argument("--league", required=True)
    backtest.add_argument("--minimum-train-seasons", type=int, default=3)
    backtest.set_defaults(handler=run_backtest)
    predict = commands.add_parser("predict")
    predict.set_defaults(handler=predict_upcoming)
    status = commands.add_parser("status")
    status.set_defaults(handler=show_status)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
