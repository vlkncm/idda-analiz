from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.football import Match, MatchStatus, Season, Team, TeamSeason
from app.models.operational import MatchTeamStats, OddsSnapshot
from app.providers.base import DataProvider


class IngestionService:
    def __init__(self, session: Session):
        self.session = session

    def ingest(self, provider: DataProvider, season: Season) -> int:
        league_code = season.league.code
        teams: dict[str, Team] = {}
        for item in provider.get_teams(league_code, season.name):
            code = f"{provider.name}:{item.external_id}"
            team = self.session.scalar(select(Team).where(Team.code == code))
            if team is None:
                team = Team(code=code, name=item.name, country_code=item.country_code, provider=provider.name, provider_team_id=item.external_id)
                self.session.add(team)
                self.session.flush()
            teams[item.external_id] = team
            if self.session.scalar(
                select(TeamSeason).where(
                    TeamSeason.season_id == season.id, TeamSeason.team_id == team.id
                )
            ) is None:
                self.session.add(TeamSeason(season_id=season.id, team_id=team.id))

        changed = 0
        for item in provider.get_matches(league_code, season.name):
            match = self.session.scalar(
                select(Match).where(
                    Match.provider == provider.name,
                    Match.external_id == item.external_id,
                )
            )
            values = {
                "league_id": season.league_id,
                "season_id": season.id,
                "home_team_id": teams[item.home_team_external_id].id,
                "away_team_id": teams[item.away_team_external_id].id,
                "kickoff_at": item.kickoff_at,
                "home_goals": item.home_goals,
                "away_goals": item.away_goals,
                "status": MatchStatus.FINISHED if item.home_goals is not None and item.away_goals is not None else MatchStatus.SCHEDULED,
            }
            if match is None:
                match = Match(provider=provider.name, external_id=item.external_id, **values)
                self.session.add(match)
                self.session.flush()
            else:
                for key, value in values.items():
                    setattr(match, key, value)
            self._stats(match, teams[item.home_team_external_id], True, item)
            self._stats(match, teams[item.away_team_external_id], False, item)
            self._odds(match, item)
            changed += 1
        self.session.commit()
        return changed

    def _stats(self, match: Match, team: Team, home: bool, item) -> None:
        row = self.session.scalar(select(MatchTeamStats).where(MatchTeamStats.match_id == match.id, MatchTeamStats.team_id == team.id))
        if row is None:
            row = MatchTeamStats(match_id=match.id, team_id=team.id, is_home=home)
            self.session.add(row)
        prefix, opponent = ("home", "away") if home else ("away", "home")
        row.goals = getattr(item, f"{prefix}_goals")
        row.goals_conceded = getattr(item, f"{opponent}_goals")
        row.shots = getattr(item, f"{prefix}_shots")
        row.shots_on_target = getattr(item, f"{prefix}_shots_on_target")
        row.corners = getattr(item, f"{prefix}_corners")
        row.yellow_cards = getattr(item, f"{prefix}_yellow_cards")
        row.red_cards = getattr(item, f"{prefix}_red_cards")

    def _odds(self, match: Match, item) -> None:
        captured = item.odds_captured_at
        if captured is None or captured >= item.kickoff_at:
            return
        values = (("1X2", "1", item.home_odds), ("1X2", "X", item.draw_odds), ("1X2", "2", item.away_odds), ("OVER_UNDER_2.5", "OVER", item.over25_odds), ("OVER_UNDER_2.5", "UNDER", item.under25_odds))
        for market, selection, value in values:
            if value is None or value <= 1:
                continue
            exists = self.session.scalar(select(OddsSnapshot.id).where(OddsSnapshot.match_id == match.id, OddsSnapshot.bookmaker == "Football-Data market average/closing", OddsSnapshot.market == market, OddsSnapshot.selection == selection, OddsSnapshot.captured_at == captured))
            if exists is None:
                self.session.add(OddsSnapshot(match_id=match.id, bookmaker="Football-Data market average/closing", market=market, selection=selection, odds=value, captured_at=captured))
