import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.football import League, Match, MatchStatus, Season, Team, TeamSeason
from app.models.operational import Lineup, MatchTeamStats, OddsSnapshot, Player, PlayerAbsence, SyncState
from app.providers.sportmonks import SportmonksProvider, discover_target_leagues
from app.providers.sportmonks_parser import parse_fixture, parse_odds
from app.services.settlement import settle_match


logger = logging.getLogger(__name__)
COUNTRY_CODES = {"Turkey": "TR", "England": "GB", "Germany": "DE", "Italy": "IT", "France": "FR"}
TIMEZONES = {"TR-SL": "Europe/Istanbul", "EN-PL": "Europe/London", "DE-BL": "Europe/Berlin", "IT-SA": "Europe/Rome", "FR-L1": "Europe/Paris"}


@dataclass(slots=True)
class SyncReport:
    leagues: int = 0
    seasons: int = 0
    teams: int = 0
    fixtures: int = 0
    stats: int = 0
    lineups: int = 0
    absences: int = 0
    odds: int = 0


class DatabaseResponseCache:
    def __init__(self, session: Session, ttl: timedelta = timedelta(hours=6)):
        self.session, self.ttl = session, ttl

    def get(self, key: str) -> dict | None:
        row = self.session.get(SyncState, key)
        if row is None or datetime.now(timezone.utc) - _aware(row.last_synced_at) > self.ttl:
            return None
        return (row.metadata_json or {}).get("response")

    def set(self, key: str, response: dict) -> None:
        row = self.session.get(SyncState, key)
        if row is None:
            self.session.add(SyncState(key=key, last_synced_at=datetime.now(timezone.utc), metadata_json={"response": response}))
        else:
            row.last_synced_at = datetime.now(timezone.utc)
            row.metadata_json = {"response": response}
        self.session.commit()


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _date(value: str | None, fallback: date) -> date:
    return date.fromisoformat(value[:10]) if value else fallback


class SportmonksSyncService:
    def __init__(self, session: Session, provider: SportmonksProvider, history_seasons: int = 5):
        self.db, self.provider, self.history_seasons = session, provider, max(1, history_seasons)

    def sync(self) -> SyncReport:
        report = SyncReport()
        discovered = discover_target_leagues(self.provider.get_leagues())
        for code, source in discovered:
            league = self._league(code, source)
            report.leagues += 1
            seasons = sorted(source.get("seasons") or self.provider.get_seasons(int(source["id"])), key=lambda row: row.get("starting_at") or "", reverse=True)
            selected = seasons[: self.history_seasons]
            logger.info("sportmonks_seasons_selected", extra={"fields": {"league": code, "available": len(seasons), "selected": len(selected)}})
            for season_source in reversed(selected):
                season = self._season(league, season_source)
                report.seasons += 1
                teams = self.provider.get_teams(int(season_source["id"]))
                for source_team in teams:
                    self._team(season, source_team)
                    report.teams += 1
                for basic_fixture in self.provider.get_fixtures(int(season_source["id"])):
                    detail = self.provider.get_fixture(int(basic_fixture["id"]))
                    self._fixture(league, season, detail, report)
                    report.fixtures += 1
                self.db.commit()
        return report

    def refresh_upcoming(self, minutes: int = 90, window: int = 20) -> SyncReport:
        now = datetime.now(timezone.utc)
        report = SyncReport()
        matches = self.db.scalars(select(Match).where(Match.provider == self.provider.name, Match.kickoff_at >= now + timedelta(minutes=max(0, minutes - window)), Match.kickoff_at <= now + timedelta(minutes=minutes + window))).all()
        for match in matches:
            league = self.db.get(League, match.league_id)
            season = self.db.get(Season, match.season_id)
            self._fixture(league, season, self.provider.get_fixture(int(match.external_id)), report)
            report.fixtures += 1
        self.db.commit()
        return report

    def _league(self, code: str, source: dict) -> League:
        league = self.db.scalar(select(League).where(League.code == code))
        country = source.get("country") or {}
        if league is None:
            league = League(code=code, name=source["name"], country_code=COUNTRY_CODES.get(country.get("name"), country.get("iso2") or "XX"), timezone=TIMEZONES[code])
            self.db.add(league)
        league.provider = self.provider.name
        league.provider_league_id = str(source["id"])
        league.is_active = bool(source.get("active", True))
        self.db.flush()
        return league

    def _season(self, league: League, source: dict) -> Season:
        provider_id = str(source["id"])
        season = self.db.scalar(select(Season).where(Season.provider == self.provider.name, Season.provider_season_id == provider_id))
        if season is None:
            today = date.today()
            season = Season(league_id=league.id, name=source.get("name") or provider_id, start_date=_date(source.get("starting_at"), today), end_date=_date(source.get("ending_at"), today + timedelta(days=365)), provider=self.provider.name, provider_season_id=provider_id)
            self.db.add(season)
        season.is_current = bool(source.get("is_current"))
        self.db.flush()
        return season

    def _team(self, season: Season, source: dict) -> Team:
        provider_id = str(source["id"])
        team = self.db.scalar(select(Team).where(Team.provider == self.provider.name, Team.provider_team_id == provider_id))
        if team is None:
            team = Team(code=f"sportmonks:{provider_id}", name=source.get("name") or source.get("short_code") or provider_id, country_code=(source.get("country") or {}).get("iso2") or season.league.country_code, provider=self.provider.name, provider_team_id=provider_id)
            self.db.add(team)
            self.db.flush()
        if self.db.scalar(select(TeamSeason).where(TeamSeason.season_id == season.id, TeamSeason.team_id == team.id)) is None:
            self.db.add(TeamSeason(season_id=season.id, team_id=team.id))
        return team

    def _fixture(self, league: League, season: Season, payload: dict, report: SyncReport) -> Match:
        parsed = parse_fixture(payload)
        home = self._ensure_team(season, parsed.home_provider_team_id, parsed.home_name)
        away = self._ensure_team(season, parsed.away_provider_team_id, parsed.away_name)
        match = self.db.scalar(select(Match).where(Match.provider == self.provider.name, Match.external_id == parsed.provider_match_id))
        if match is None:
            match = Match(league_id=league.id, season_id=season.id, home_team_id=home.id, away_team_id=away.id, kickoff_at=parsed.kickoff_at, status=MatchStatus(parsed.status), home_goals=parsed.home_score, away_goals=parsed.away_score, provider=self.provider.name, external_id=parsed.provider_match_id)
            self.db.add(match)
            self.db.flush()
        else:
            match.kickoff_at, match.status = parsed.kickoff_at, MatchStatus(parsed.status)
            if parsed.home_score is not None and parsed.away_score is not None:
                settle_match(self.db, match, parsed.home_score, parsed.away_score, commit=False)
        team_map = {parsed.home_provider_team_id: home, parsed.away_provider_team_id: away}
        for stats in parsed.team_stats:
            team = team_map[stats["provider_team_id"]]
            row = self.db.scalar(select(MatchTeamStats).where(MatchTeamStats.match_id == match.id, MatchTeamStats.team_id == team.id))
            if row is None:
                row = MatchTeamStats(match_id=match.id, team_id=team.id, is_home=stats["is_home"])
                self.db.add(row)
            for field in ("goals", "goals_conceded", "xg", "xga", "shots", "shots_on_target", "possession", "corners"):
                setattr(row, field, stats[field])
            report.stats += 1
        for lineup in parsed.lineups:
            player = self._player(lineup)
            team = team_map.get(lineup["provider_team_id"]) or self._ensure_team(season, lineup["provider_team_id"], lineup["provider_team_id"])
            row = self.db.scalar(select(Lineup).where(Lineup.match_id == match.id, Lineup.team_id == team.id, Lineup.player_id == player.id))
            if row is None:
                row = Lineup(match_id=match.id, team_id=team.id, player_id=player.id)
                self.db.add(row)
            for field in ("is_starting", "position_id", "formation_position", "jersey_number", "is_confirmed"):
                setattr(row, field, lineup[field])
            report.lineups += 1
        for absence in parsed.absences:
            player = self._player(absence)
            team = team_map.get(absence["provider_team_id"]) or self._ensure_team(season, absence["provider_team_id"], absence["provider_team_id"])
            if self.db.scalar(select(PlayerAbsence).where(PlayerAbsence.match_id == match.id, PlayerAbsence.player_id == player.id, PlayerAbsence.reason == absence["reason"])) is None:
                self.db.add(PlayerAbsence(match_id=match.id, team_id=team.id, player_id=player.id, reason=absence["reason"], category=absence["category"], observed_at=datetime.now(timezone.utc)))
                report.absences += 1
        if payload.get("has_odds"):
            odds_payload = self.provider.get_odds(int(parsed.provider_match_id)) or {}
            for odds in parse_odds(odds_payload.get("data") or []):
                identity = select(OddsSnapshot).where(OddsSnapshot.match_id == match.id, OddsSnapshot.bookmaker == odds["bookmaker"], OddsSnapshot.market == odds["market"], OddsSnapshot.selection == odds["selection"], OddsSnapshot.captured_at == odds["captured_at"])
                if self.db.scalar(identity) is None:
                    self.db.add(OddsSnapshot(match_id=match.id, **odds))
                    report.odds += 1
        return match

    def _ensure_team(self, season: Season, provider_id: str, name: str) -> Team:
        existing = self.db.scalar(select(Team).where(Team.provider == self.provider.name, Team.provider_team_id == provider_id))
        return existing or self._team(season, {"id": int(provider_id), "name": name})

    def _player(self, source: dict) -> Player:
        provider_id = source["provider_player_id"]
        player = self.db.scalar(select(Player).where(Player.provider == self.provider.name, Player.provider_player_id == provider_id))
        if player is None:
            player = Player(provider=self.provider.name, provider_player_id=provider_id, name=source["player_name"], position_id=source.get("position_id"))
            self.db.add(player)
            self.db.flush()
        return player
