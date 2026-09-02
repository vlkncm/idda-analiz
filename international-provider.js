const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/123';
const FOOTBALL_DATA_BASE_URL = 'https://www.football-data.co.uk/mmz4281';
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const leagueIds = new Map([
  [39, 4328],
  [140, 4335],
  [78, 4331],
  [135, 4332],
  [61, 4334]
]);
const footballDataDivisions = new Map([
  [203, 'T1'],
  [39, 'E0'],
  [140, 'SP1'],
  [78, 'D1'],
  [135, 'I1'],
  [61, 'F1']
]);
const espnLeagues = new Map([
  [203, 'tur.1'],
  [39, 'eng.1'],
  [140, 'esp.1'],
  [78, 'ger.1'],
  [135, 'ita.1'],
  [61, 'fra.1']
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

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function normalizeEspnEvent(event, league) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find(team => team.homeAway === 'home');
  const away = competitors.find(team => team.homeAway === 'away');
  if (!event.id || !event.date || !home?.team?.displayName || !away?.team?.displayName) return null;
  return {
    id: `free-espn-${event.id}`,
    leagueId: league.id,
    home: home.team.displayName,
    away: away.team.displayName,
    homeLogo: home.team.logo || '',
    awayLogo: away.team.logo || '',
    date: event.date,
    status: event.status?.type?.state === 'pre' ? 'NS' : (event.status?.type?.completed ? 'FT' : event.status?.type?.shortDetail || 'LIVE'),
    venue: competition.venue?.fullName || 'Belirtilmedi',
    referee: 'Henüz atanmadı',
    homeScore: home.score == null || home.score === '' ? null : Number(home.score),
    awayScore: away.score == null || away.score === '' ? null : Number(away.score),
    over25: null,
    btts: null,
    confidence: null,
    reasons: ['ESPN ücretsiz fikstür verisi', 'Ayrıntılı analiz geçmiş lig verilerinden hesaplanır'],
    demo: false,
    source: 'ESPN',
    sourceUrl: event.links?.[0]?.href || null
  };
}

async function fetchEspnLeague(league, date = new Date()) {
  const slug = espnLeagues.get(Number(league.id));
  if (!slug) return [];
  const end = new Date(date.getTime() + 14 * 24 * 60 * 60 * 1000);
  const url = `${ESPN_BASE_URL}/${slug}/scoreboard?dates=${compactDate(date)}-${compactDate(end)}&limit=100`;
  const response = await fetch(url, { headers: { 'User-Agent': 'IDDA-Analiz/1.2', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ESPN ${league.name}: ${response.status}`);
  const payload = await response.json();
  return (payload.events || []).map(event => normalizeEspnEvent(event, league)).filter(Boolean).filter(match => {
    const time = new Date(match.date).getTime();
    return Number.isFinite(time) && time >= date.getTime() - 3 * 60 * 60 * 1000 && time <= end.getTime() + 24 * 60 * 60 * 1000;
  });
}

async function fetchLeague(league, date = new Date()) {
  const externalId = leagueIds.get(league.id);
  if (!externalId) return [];
  // The free season endpoint can return only a partial season. The dedicated
  // next-events endpoint is therefore queried as well and both are merged.
  const urls = [
    `${BASE_URL}/eventsnextleague.php?id=${externalId}`,
    `${BASE_URL}/eventsseason.php?id=${externalId}&s=${seasonLabel(date)}`
  ];
  const settled = await Promise.allSettled(urls.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()).events || [];
  }));
  const events = [...new Map(settled.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(event => [String(event.idEvent), event])).values()];
  if (!events.length) {
    const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason.message).join(', ');
    throw new Error(`TheSportsDB ${league.name}: ${errors || 'fikstür bulunamadı'}`);
  }
  const from = date.getTime() - 3 * 60 * 60 * 1000;
  const to = date.getTime() + 14 * 24 * 60 * 60 * 1000;
  return events.map(event => normalizeEvent(event, league)).filter(match => {
    const time = new Date(match.date).getTime();
    return Number.isFinite(time) && time >= from && time <= to;
  });
}

function footballDataSeasonCode(startYear) {
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(value); value = ''; }
    else value += character;
  }
  cells.push(value);
  return cells;
}

function parseFootballDataCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const at = name => headers.indexOf(name);
  const required = ['HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'];
  if (required.some(name => at(name) < 0)) return [];
  return lines.slice(1).flatMap(line => {
    const cells = parseCsvLine(line);
    const home = cells[at('HomeTeam')]?.trim();
    const away = cells[at('AwayTeam')]?.trim();
    const homeScore = cells[at('FTHG')];
    const awayScore = cells[at('FTAG')];
    if (!home || !away || homeScore === '' || awayScore === '' || !Number.isFinite(Number(homeScore)) || !Number.isFinite(Number(awayScore))) return [];
    return [{
      home,
      away,
      home_score: Number(homeScore),
      away_score: Number(awayScore),
      home_ht: Number(cells[at('HTHG')]) || 0,
      away_ht: Number(cells[at('HTAG')]) || 0,
      date: at('Date') >= 0 ? cells[at('Date')] : '',
      status: 'finished',
      source: 'Football-Data.co.uk'
    }];
  });
}

async function fetchFootballDataHistory(leagueId, date = new Date()) {
  const division = footballDataDivisions.get(Number(leagueId));
  if (!division) return [];
  const start = date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear();
  const seasons = [start, start - 1, start - 2, start - 3];
  const settled = await Promise.allSettled(seasons.map(async year => {
    const url = `${FOOTBALL_DATA_BASE_URL}/${footballDataSeasonCode(year)}/${division}.csv`;
    const response = await fetch(url, { headers: { 'User-Agent': 'IDDA-Analiz/1.2' } });
    if (!response.ok) throw new Error(`Football-Data ${division} ${year}: ${response.status}`);
    return parseFootballDataCsv(await response.text());
  }));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

async function fetchInternationalMatches(leagues, date = new Date()) {
  const settled = await Promise.allSettled(leagues.filter(league => espnLeagues.has(Number(league.id)) || leagueIds.has(Number(league.id))).map(async league => {
    try {
      const matches = await fetchEspnLeague(league, date);
      if (matches.length) return { matches, warning: null };
      throw new Error(`ESPN ${league.name}: fikstür bulunamadı`);
    } catch (error) {
      if (!leagueIds.has(Number(league.id))) throw error;
      const fallback = await fetchLeague(league, date);
      return { matches: fallback, warning: `${error.message}; TheSportsDB yedeği kullanıldı` };
    }
  }));
  return {
    matches: settled.flatMap(result => result.status === 'fulfilled' ? result.value.matches : []),
    warnings: settled.flatMap(result => result.status === 'rejected' ? [result.reason.message] : result.value.warning ? [result.value.warning] : [])
  };
}

async function fetchLeagueHistory(leagueId, date = new Date()) {
  const externalId = leagueIds.get(Number(leagueId));
  const division = footballDataDivisions.get(Number(leagueId));
  if (!externalId && !division) return [];
  const start = date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear();
  const cacheKey = `${leagueId}-${start}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached.rows;
  const footballDataRows = await fetchFootballDataHistory(leagueId, date);
  // Four Football-Data seasons normally provide hundreds of completed games
  // and are much more complete than the capped free TheSportsDB response.
  if (footballDataRows.length >= 100) {
    historyCache.set(cacheKey, { time:Date.now(), rows:footballDataRows });
    return footballDataRows;
  }
  const sportsDbRows = externalId ? await Promise.allSettled([start, start - 1, start - 2, start - 3].map(async year => {
    const response = await fetch(`${BASE_URL}/eventsseason.php?id=${externalId}&s=${year}-${year + 1}`);
    if (!response.ok) throw new Error(`TheSportsDB geçmiş veri: ${response.status}`);
    return (await response.json()).events || [];
  })).then(results => results.flatMap(result => result.status === 'fulfilled' ? result.value : []).flatMap(event => event.intHomeScore == null || event.intAwayScore == null ? [] : [{ home:event.strHomeTeam, away:event.strAwayTeam, home_score:Number(event.intHomeScore), away_score:Number(event.intAwayScore), home_ht:Number(event.intHomeScoreHalfTime)||0, away_ht:Number(event.intAwayScoreHalfTime)||0, status:'finished', source:'TheSportsDB' }])) : [];
  const rows = [...new Map([...footballDataRows, ...sportsDbRows].map(row => [`${row.date || ''}|${row.home}|${row.away}|${row.home_score}|${row.away_score}`, row])).values()];
  historyCache.set(cacheKey, { time:Date.now(), rows });
  return rows;
}

module.exports = { fetchInternationalMatches, fetchLeagueHistory, fetchFootballDataHistory, normalizeEvent, normalizeEspnEvent, seasonLabel, footballDataSeasonCode, parseCsvLine, parseFootballDataCsv };
