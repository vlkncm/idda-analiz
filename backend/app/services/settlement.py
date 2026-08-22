from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.football import Match, MatchStatus
from app.models.prediction import Prediction, ResultCode


def settle_match(session: Session, match: Match, home_goals: int, away_goals: int, commit: bool = True) -> int:
    if home_goals < 0 or away_goals < 0:
        raise ValueError("goals cannot be negative")
    match.home_goals = home_goals
    match.away_goals = away_goals
    match.status = MatchStatus.FINISHED
    actual = ResultCode.HOME if home_goals > away_goals else ResultCode.DRAW if home_goals == away_goals else ResultCode.AWAY
    predictions = session.scalars(select(Prediction).where(Prediction.match_id == match.id)).all()
    for prediction in predictions:
        prediction.actual_result = actual
        prediction.actual_total_goals = home_goals + away_goals
        prediction.actual_over25 = home_goals + away_goals > 2
        prediction.resolved_at = datetime.now(timezone.utc)
    if commit:
        session.commit()
    return len(predictions)
