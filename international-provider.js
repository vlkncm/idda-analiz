const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/123';

const leagueIds = new Map([
  [39, 4328],
  [140, 4335],
  [78, 4331],
  [135, 4332],
  [61, 4334]
]);
const historyCache = new Map();

function seasonLabel(date = new Date()) {
  const start = date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear();
  return `${start}-${start + 1}`;
}

function normalizeEvent(event, league) {
  const timestamp = event.strTimestamp || `${event.dateEvent}T${event.strTime || '12:00:00'}Z`;
  return {
    id: `free-tsdb-${event.idEvent}`, leagueId: league.id,
    home: event.strHomeTeam, away: event.strAwayTeam,
    homeLogo: event.strHomeTeamBadge || '', awayLogo: event.strAwayTeamBadge || '',
    date: timestamp.endsWith('Z') || /[+-]\d\d:\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`,
    status: event.strStatus || 'NS', venue: event.strVenue || 'Belirtilmedi',
    referee: event.strOfficial || 'Henüz atanmadı',
    homeScore: event.intHomeScore == null ? null : Number(event.intHomeScore),
    awayScore: event.intAwayScore == null ? null : Number(event.intAwayScore),
    over25: null, btts: null, confidence: null,
    reasons: ['TheSportsDB ücretsiz fikstür verisi', 'Ayrıntılı analiz mevcut geçmiş verilerinden hesaplanır'],
    demo: false, source: 'TheSportsDB', sourceUrl: `https://www.thesportsdb.com/event/${event.idEvent}`
  };
}

async function fetchLeague(league, date = new Date()) {
  const externalId = leagueIds.get(league.id);
  if (!externalId) return [];
  const response = await fetch(`${BASE_URL}/eventsseason.php?id=${externalId}&s=${seasonLabel(date)}`);
  if (!response.ok) throw new Error(`TheSportsDB ${league.name}: ${response.status}`);
  const events = (await response.json()).events || [];
  const from = date.getTime() - 3 * 60 * 60 * 1000;
  const to = date.getTime() + 8 * 24 * 60 * 60 * 1000;
  return events.map(event => normalizeEvent(event, league)).filter(match => {
    const time = new Date(match.date).getTime();
    return Number.isFinite(time) && time >= from && time <= to;
  });
}

async function fetchInternationalMatches(leagues, date = new Date()) {
  const settled = await Promise.allSettled(leagues.filter(league => leagueIds.has(league.id)).map(league => fetchLeague(league, date)));
  return {
    matches: settled.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    warnings: settled.flatMap(result => result.status === 'rejected' ? [result.reason.message] : [])
  };
}

async function fetchLeagueHistory(leagueId, date = new Date()) {
  const externalId = leagueIds.get(Number(leagueId));
  if (!externalId) return [];
  const start = date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear();
  const cacheKey = `${externalId}-${start}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached.rows;
  const seasons = [start, start - 1, start - 2, start - 3].map(year => `${year}-${year + 1}`);
  const settled = await Promise.allSettled(seasons.map(async season => {
    const response = await fetch(`${BASE_URL}/eventsseason.php?id=${externalId}&s=${season}`);
    if (!response.ok) throw new Error(`TheSportsDB geçmiş veri: ${response.status}`);
    return (await response.json()).events || [];
  }));
  const rows = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []).flatMap(event => event.intHomeScore == null || event.intAwayScore == null ? [] : [{ home:event.strHomeTeam, away:event.strAwayTeam, home_score:Number(event.intHomeScore), away_score:Number(event.intAwayScore), home_ht:Number(event.intHomeScoreHalfTime)||0, away_ht:Number(event.intAwayScoreHalfTime)||0, status:'finished' }]);
  historyCache.set(cacheKey, { time:Date.now(), rows });
  return rows;
}

module.exports = { fetchInternationalMatches, fetchLeagueHistory, normalizeEvent, seasonLabel };
