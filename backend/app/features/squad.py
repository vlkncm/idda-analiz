from dataclasses import dataclass


IMPORTANT_POSITIONS = {"goalkeeper", "centre-back", "central-midfield", "playmaker", "striker"}


@dataclass(frozen=True, slots=True)
class PlayerAvailability:
    player_id: str
    position: str
    is_available: bool
    minutes: float | None = None
    starts: float | None = None
    team_matches: float | None = None
    goals: float | None = None
    assists: float | None = None
    xg: float | None = None
    xa: float | None = None
    is_top_scorer: bool = False


def squad_absence_impact(players: list[PlayerAvailability] | None) -> float | None:
    if players is None:
        return None
    impact = 0.0
    for player in players:
        if player.is_available or (player.position not in IMPORTANT_POSITIONS and not player.is_top_scorer):
            continue
        minute_share = min(1.0, (player.minutes or 0) / max(1.0, (player.team_matches or 1) * 90))
        start_share = min(1.0, (player.starts or 0) / max(1.0, player.team_matches or 1))
        production = min(1.0, ((player.goals or 0) + .7 * (player.assists or 0) + (player.xg or 0) + .7 * (player.xa or 0)) / 20)
        role = 0.2 if player.position in IMPORTANT_POSITIONS else 0.0
        impact += 0.45 * minute_share + 0.25 * start_share + 0.2 * production + role + (0.2 if player.is_top_scorer else 0)
    return min(3.0, impact)

