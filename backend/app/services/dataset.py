from datetime import timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.builder import FeatureBuilder, HistoricalMatch, MatchContext
from app.modeling.dixon_coles import DixonColesEngine, DixonColesMatch
from app.modeling.elo import EloEngine
from app.models.football import League, Match, MatchStatus
from app.models.operational import EloSnapshot, MatchTeamStats, OddsSnapshot, PlayerAbsence


class TrainingDatasetBuilder:
    """Chronological database-to-feature pipeline; each row sees only earlier matches."""

    def __init__(self, session: Session, half_life_days: float = 180.0, minimum_history: int = 20):
        self.db, self.half_life_days, self.minimum_history = session, half_life_days, minimum_history

    def build(self, league: League) -> pd.DataFrame:
        matches = self.db.scalars(select(Match).where(Match.league_id == league.id, Match.status == MatchStatus.FINISHED).order_by(Match.kickoff_at)).all()
        stats = self.db.scalars(select(MatchTeamStats).where(MatchTeamStats.match_id.in_([row.id for row in matches]))).all() if matches else []
        stat_map = {(row.match_id, row.team_id): row for row in stats}
        elo = EloEngine()
        history: list[HistoricalMatch] = []
        dc_history: list[DixonColesMatch] = []
        scores: list[tuple[int, int]] = []
        rows: list[dict] = []
        for match in matches:
            kickoff = match.kickoff_at if match.kickoff_at.tzinfo else match.kickoff_at.replace(tzinfo=timezone.utc)
            home, away = str(match.home_team_id), str(match.away_team_id)
            self._save_elo(match, elo.rating(league.code, home), elo.rating(league.code, away), kickoff)
            if len(history) >= self.minimum_history and len({item.home_team for item in dc_history} | {item.away_team for item in dc_history}) >= 2:
                elo.fit_home_advantage(league.code, scores)
                elo_prediction = elo.predict(league.code, home, away)
                dc = DixonColesEngine(max_goals=10)
                dc.fit(dc_history, self.half_life_days)
                dc_prediction = dc.predict_teams(home, away)
                context = self._context(match, kickoff)
                features = FeatureBuilder(self.half_life_days).build(home, away, kickoff, history, elo.ratings.get(league.code, {}), context)
                completed = len(scores) or 1
                features.update({"league_home_win_rate": sum(h > a for h, a in scores) / completed, "league_draw_rate": sum(h == a for h, a in scores) / completed, "league_away_win_rate": sum(h < a for h, a in scores) / completed, "league_average_goals": sum(h + a for h, a in scores) / completed, "league_over25_rate": sum(h + a > 2 for h, a in scores) / completed})
                result = 0 if match.home_goals > match.away_goals else 1 if match.home_goals == match.away_goals else 2
                rows.append({**features, "season": match.season.name, "kickoff_at": kickoff, "result_target": result, "over25_target": int(match.home_goals + match.away_goals > 2), "dc_home": dc_prediction.home, "dc_draw": dc_prediction.draw, "dc_away": dc_prediction.away, "dc_over25": dc_prediction.over25, "elo_home": elo_prediction.home, "elo_draw": elo_prediction.draw, "elo_away": elo_prediction.away})
            elo.update(league.code, home, away, match.home_goals, match.away_goals)
            hs, aws = stat_map.get((match.id, match.home_team_id)), stat_map.get((match.id, match.away_team_id))
            home_xg, away_xg = (hs.xg if hs else None), (aws.xg if aws else None)
            historical = HistoricalMatch(kickoff, home, away, match.home_goals, match.away_goals, home_xg, away_xg, "league", hs.shots if hs else None, aws.shots if aws else None, hs.shots_on_target if hs else None, aws.shots_on_target if aws else None)
            history.append(historical)
            dc_history.append(DixonColesMatch(kickoff, home, away, match.home_goals, match.away_goals))
            scores.append((match.home_goals, match.away_goals))
        self.db.commit()
        return pd.DataFrame(rows)

    def _save_elo(self, match: Match, home_rating: float, away_rating: float, as_of) -> None:
        for team_id, rating in ((match.home_team_id, home_rating), (match.away_team_id, away_rating)):
            row = self.db.scalar(select(EloSnapshot).where(EloSnapshot.league_id == match.league_id, EloSnapshot.team_id == team_id, EloSnapshot.as_of == as_of))
            if row is None:
                self.db.add(EloSnapshot(league_id=match.league_id, team_id=team_id, match_id=match.id, as_of=as_of, rating=rating))

    def _context(self, match: Match, kickoff) -> MatchContext:
        absences = self.db.scalars(select(PlayerAbsence).where(PlayerAbsence.match_id == match.id)).all()
        odds_rows = self.db.scalars(select(OddsSnapshot).where(OddsSnapshot.match_id == match.id, OddsSnapshot.captured_at < kickoff).order_by(OddsSnapshot.captured_at.desc())).all()
        latest = {}
        for row in odds_rows:
            latest.setdefault((row.market, row.selection), row.odds)
        odds = None
        if all(("1X2", key) in latest for key in ("1", "X", "2")):
            odds = (latest[("1X2", "1")], latest[("1X2", "X")], latest[("1X2", "2")], latest.get(("OVER_UNDER_2.5", "OVER")), latest.get(("OVER_UNDER_2.5", "UNDER")))
        return MatchContext(league_id=match.league_id, home_missing_players=sum(row.team_id == match.home_team_id for row in absences), away_missing_players=sum(row.team_id == match.away_team_id for row in absences), home_missing_key_players=0, away_missing_key_players=0, odds=odds)
