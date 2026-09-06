'use strict';

const { fetchLeagueHistory } = require('./international-provider');
const { sameTeam } = require('./fixture-providers/model');
const { analyzeMatch: runProbabilityEngine } = require('./probability-engine');

function teamMatches(rows, name, venue = 'all') {
  return rows.filter(row => venue === 'home' ? sameTeam(row.home, name) : venue === 'away' ? sameTeam(row.away, name) : sameTeam(row.home, name) || sameTeam(row.away, name))
    .sort((left, right) => new Date(left.playedAt || left.date || 0) - new Date(right.playedAt || right.date || 0)).slice(-10);
}
function teamStats(rows, name, venue = 'all') {
  const selected = teamMatches(rows, name, venue);
  if (!selected.length) return { played: 0, wins: 0, draws: 0, losses: 0, goalsForAvg: null, goalsAgainstAvg: null, over25: null, btts: null, form: '' };
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, over = 0, btts = 0;
  for (const row of selected) {
    const isHome = sameTeam(row.home, name), scored = Number(isHome ? row.home_score : row.away_score), conceded = Number(isHome ? row.away_score : row.home_score);
    goalsFor += scored; goalsAgainst += conceded; scored > conceded ? wins++ : scored < conceded ? losses++ : draws++;
    if (scored + conceded >= 3) over++; if (scored > 0 && conceded > 0) btts++;
  }
  return { played: selected.length, wins, draws, losses, goalsForAvg: goalsFor / selected.length, goalsAgainstAvg: goalsAgainst / selected.length, over25: 100 * over / selected.length, btts: 100 * btts / selected.length, form: selected.map(row => { const isHome = sameTeam(row.home, name), a = Number(isHome ? row.home_score : row.away_score), b = Number(isHome ? row.away_score : row.home_score); return a > b ? 'W' : a < b ? 'L' : 'D'; }).join('') };
}
function h2hStats(rows, homeName, awayName, asOf = new Date()) {
  const cutoff = new Date(asOf).getTime() - 2 * 365.25 * 86400000;
  const selected = rows.filter(row => row.playedAt && new Date(row.playedAt).getTime() >= cutoff && ((sameTeam(row.home, homeName) && sameTeam(row.away, awayName)) || (sameTeam(row.home, awayName) && sameTeam(row.away, homeName))));
  return selected.length ? { played: selected.length } : null;
}
async function internationalAnalysis(match, { fetchHistory = fetchLeagueHistory } = {}) {
  if (!match || !Number.isFinite(Number(match.leagueId))) throw new Error('Analiz için lig kimliği gerekli');
  const rows = await fetchHistory(Number(match.leagueId), new Date(match.kickoffUtc || match.date));
  const homeFound = rows.some(row => sameTeam(row.home, match.home) || sameTeam(row.away, match.home)), awayFound = rows.some(row => sameTeam(row.home, match.away) || sameTeam(row.away, match.away));
  const output = runProbabilityEngine({ match, rows });
  return { ...output, free: true, leagueId: Number(match.leagueId), historySources: [...new Set(rows.map(row => row.source).filter(Boolean))], matchedTeams: { home: homeFound ? match.home : null, away: awayFound ? match.away : null }, limitations: [...(output.decisionReasons || []), ...(output.xg?.message ? [output.xg.message] : [])] };
}

module.exports = { internationalAnalysis, teamMatches, teamStats, h2hStats };
