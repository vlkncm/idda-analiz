import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.builder import FeatureBuilder, HistoricalMatch, MatchContext
from app.modeling.artifact import PredictionArtifact
from app.modeling.dixon_coles import DixonColesEngine, DixonColesMatch
from app.modeling.elo import EloEngine, EloMatch
from app.models.football import League, Match, MatchStatus
from app.models.operational import MatchTeamStats, PlayerAbsence
from app.models.prediction import ModelVersion, Prediction
from app.services.prediction import PredictionService


logger = logging.getLogger(__name__)


class PredictionAutomationService:
    def __init__(self, session: Session, artifact_dir: str | Path, half_life_days: float = 180.0, elo_initial: float = 1500.0, elo_k: float = 24.0):
        self.db = session
        self.artifact_dir = Path(artifact_dir)
        self.half_life_days = half_life_days
        self.elo_initial = elo_initial
        self.elo_k = elo_k

    def predict_upcoming(self, within: timedelta = timedelta(days=7), prematch_refresh: bool = False) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        model_version = self.db.scalar(select(ModelVersion).where(ModelVersion.is_production.is_(True)).order_by(ModelVersion.created_at.desc()))
        if model_version is None:
            return {"created": 0, "skipped": 0, "missing_model": 1}
        matches = self.db.scalars(select(Match).where(Match.kickoff_at > now, Match.kickoff_at <= now + within).order_by(Match.kickoff_at)).all()
        created = skipped = missing_model = 0
        for match in matches:
            latest_prediction = self.db.scalar(select(Prediction).where(Prediction.match_id == match.id, Prediction.model_version_id == model_version.id).order_by(Prediction.prediction_timestamp.desc()))
            if latest_prediction and (not prematch_refresh or _aware(latest_prediction.prediction_timestamp) >= now - timedelta(minutes=30)):
                skipped += 1
                continue
            league = self.db.get(League, match.league_id)
            artifact_path = self.artifact_dir / f"{league.code}-{model_version.version}.joblib"
            if not artifact_path.exists():
                missing_model += 1
                continue
            history_rows = self.db.scalars(select(Match).where(Match.league_id == match.league_id, Match.status == MatchStatus.FINISHED, Match.kickoff_at < match.kickoff_at).order_by(Match.kickoff_at)).all()
            if len(history_rows) < 20:
                skipped += 1
                logger.warning("prediction_insufficient_history", extra={"fields": {"match_id": match.id, "history_matches": len(history_rows)}})
                continue
            stats = self.db.scalars(select(MatchTeamStats).where(MatchTeamStats.match_id.in_([row.id for row in history_rows]))).all()
            xg = {(row.match_id, row.team_id): row.xg for row in stats}
            historical = [HistoricalMatch(_aware(row.kickoff_at), str(row.home_team_id), str(row.away_team_id), row.home_goals, row.away_goals, xg.get((row.id, row.home_team_id)), xg.get((row.id, row.away_team_id))) for row in history_rows]
            elo = EloEngine(self.elo_k, self.elo_initial)
            elo.process_history([EloMatch(_aware(row.kickoff_at), league.code, str(row.home_team_id), str(row.away_team_id), row.home_goals, row.away_goals) for row in history_rows])
            elo_values = elo.ratings.get(league.code, {})
            context = self._context(match)
            features = FeatureBuilder(self.half_life_days).build(str(match.home_team_id), str(match.away_team_id), _aware(match.kickoff_at), historical, elo_values, context)
            dc = DixonColesEngine(max_goals=10)
            dc.fit([DixonColesMatch(item.kickoff_at, item.home_team, item.away_team, item.home_goals, item.away_goals) for item in historical], self.half_life_days)
            dc_prediction = dc.predict_teams(str(match.home_team_id), str(match.away_team_id))
            dc_values = (dc_prediction.home, dc_prediction.draw, dc_prediction.away, dc_prediction.over25)
            PredictionService(self.db).predict_and_store(match, model_version, PredictionArtifact.load(artifact_path), features, dc_values, None)
            created += 1
        return {"created": created, "skipped": skipped, "missing_model": missing_model}

    def _context(self, match: Match) -> MatchContext:
        absences = self.db.scalars(select(PlayerAbsence).where(PlayerAbsence.match_id == match.id)).all()
        home_missing = sum(row.team_id == match.home_team_id for row in absences)
        away_missing = sum(row.team_id == match.away_team_id for row in absences)
        return MatchContext(league_id=match.league_id, home_missing_players=home_missing, away_missing_players=away_missing, home_missing_key_players=0, away_missing_key_players=0)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
