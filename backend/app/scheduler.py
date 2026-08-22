import logging
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import get_settings
from app.db.session import create_session_factory
from app.providers.football_data_uk import FootballDataUkProvider
from app.services.automation import PredictionAutomationService
from app.services.free_data_sync import FreeDataSyncService


logger = logging.getLogger(__name__)


def _services(session):
    settings = get_settings()
    sync = FreeDataSyncService(session, FootballDataUkProvider(settings.football_data_uk_base_url), settings.history_seasons)
    predictions = PredictionAutomationService(session, settings.artifact_dir, settings.feature_half_life_days, settings.elo_initial_rating, settings.elo_k_factor)
    return sync, predictions


def daily_job() -> None:
    with create_session_factory()() as session:
        sync, predictions = _services(session)
        sync.sync()
        predictions.predict_upcoming(timedelta(days=7))


def prematch_job() -> None:
    with create_session_factory()() as session:
        settings = get_settings()
        sync, predictions = _services(session)
        predictions.predict_upcoming(timedelta(minutes=settings.prematch_refresh_minutes + 20), prematch_refresh=True)


def start_scheduler() -> BackgroundScheduler | None:
    settings = get_settings()
    if not settings.scheduler_enabled:
        logger.info("scheduler_disabled")
        return None
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(daily_job, "interval", hours=6, id="free-csv-sync", replace_existing=True, max_instances=1)
    scheduler.add_job(prematch_job, "interval", minutes=30, id="prematch-predict", replace_existing=True, max_instances=1)
    scheduler.start()
    logger.info("scheduler_started")
    return scheduler
