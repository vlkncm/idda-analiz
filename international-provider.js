'use strict';

const { parseCsv } = require('./fixture-providers/football-data-uk');
const { canonicalTeamName, LEAGUES } = require('./fixture-providers/model');

const SPORTS_DB_BASE_URL = 'https://www.thesportsdb.com/api/v1/json/123';
const FOOTBALL_DATA_UK_BASE_URL = 'https://www.football-data.co.uk/mmz4281';
const FOOTBALL_DATA_UK_LEAGUES = Object.freeze({ 39: 'E0', 140: 'SP1', 78: 'D1', 135: 'I1', 61: 'F1', 203: 'T1' });
const SPORTS_DB_LEAGUES = Object.freeze({ 39: 4328, 140: 4335, 78: 4331, 135: 4332, 61: 4334 });
const FOOTBALL_DATA_ARCHIVE_SLUGS = Object.freeze({ 39: 'premier-league', 140: 'la-liga', 78: 'bundesliga', 135: 'serie-a', 61: 'ligue-1' });
const historyCache = new Map();
const historyInFlight = new Map();
const historyWarnings = new Map();
const HISTORY_CACHE_MS = 6 * 60 * 60 * 1000;

function seasonStart(date = new Date()) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error('Geçersiz sezon tarihi');
  return value.getMonth() + 1 >= 7 ? value.getFullYear() : value.getFullYear() - 1;
}
function seasonLabel(date = new Date()) { const start = seasonStart(date); return `${start}-${start + 1}`; }
function footballDataSeasonCode(start) { return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`; }
function footballDataHistoryUrl(leagueId, start) {
  const division = FOOTBALL_DATA_UK_LEAGUES[Number(leagueId)];
  return division ? `${FOOTBALL_DATA_UK_BASE_URL}/${footballDataSeasonCode(start)}/${division}.csv` : null;
}
function parseDate(value) {
  const parts = String(value || '').split(/[/-]/).map(Number);
  const [day, month, rawYear] = parts[0] > 1900 ? [parts[2], parts[1], parts[0]] : parts;
  if (![day, month, rawYear].every(Number.isFinite)) return null;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return new Date(Date.UTC(year, month - 1, day, 12));
}
function csvHistoryRows(text, leagueId) {
  const division = FOOTBALL_DATA_UK_LEAGUES[Number(leagueId)];
  const lines = String(text || '').split(/\r?\n/);
  const compatibleText = lines[0]?.split(',').includes('Div') ? text : [`Div,${lines[0]}`, ...lines.slice(1).map(line => line ? `${division},${line}` : line)].join('\n');
  return parseCsv(compatibleText).flatMap(row => {
    if (row.Div && row.Div !== FOOTBALL_DATA_UK_LEAGUES[Number(leagueId)]) return [];
    if (row.FTHG == null || row.FTAG == null || String(row.FTHG).trim() === '' || String(row.FTAG).trim() === '') return [];
    const homeScore = Number(row.FTHG), awayScore = Number(row.FTAG);
    if (!row.HomeTeam || !row.AwayTeam || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return [];
    return [{ leagueId: Number(leagueId), home: row.HomeTeam, away: row.AwayTeam, home_score: homeScore, away_score: awayScore, home_ht: row.HTHG === '' ? null : Number(row.HTHG), away_ht: row.HTAG === '' ? null : Number(row.HTAG), homeXg: null, awayXg: null, homeShots: row.HS === '' || row.HS == null ? null : Number(row.HS), awayShots: row.AS === '' || row.AS == null ? null : Number(row.AS), homeShotsOnTarget: row.HST === '' || row.HST == null ? null : Number(row.HST), awayShotsOnTarget: row.AST === '' || row.AST == null ? null : Number(row.AST), homeRedCards: row.HR === '' || row.HR == null ? null : Number(row.HR), awayRedCards: row.AR === '' || row.AR == null ? null : Number(row.AR), competitionType: 'league', playedAt: parseDate(row.Date)?.toISOString() || null, status: 'finished', source: 'Football-Data.co.uk' }];
  });
}
function sportsDbHistoryRows(events, leagueId) {
  return (events || []).flatMap(event => event?.intHomeScore == null || event?.intAwayScore == null || !event.strHomeTeam || !event.strAwayTeam ? [] : [{ leagueId: Number(leagueId), home: event.strHomeTeam, away: event.strAwayTeam, home_score: Number(event.intHomeScore), away_score: Number(event.intAwayScore), home_ht: event.intHomeScoreHalfTime == null ? null : Number(event.intHomeScoreHalfTime), away_ht: event.intAwayScoreHalfTime == null ? null : Number(event.intAwayScoreHalfTime), playedAt: event.dateEvent ? `${event.dateEvent}T12:00:00Z` : null, status: 'finished', source: 'TheSportsDB' }]);
}
function parseOpenFootball(text) {
  const value = String(text || ''), season = value.match(/(20\d{2})[/-]\d{2}/), startYear = Number(season?.[1]);
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  let playedAt = null; const rows = [];
  for (const line of value.split(/\r?\n/)) {
    const date = line.match(/^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(20\d{2}))?/);
    if (date) { const month = months[date[1]], year = Number(date[3]) || (month >= 6 ? startYear : startYear + 1); if (Number.isFinite(year) && month !== undefined) playedAt = new Date(Date.UTC(year, month, Number(date[2]), 12)).toISOString(); continue; }
    const match = line.match(/^\s*(?:\d{1,2}:\d{2}\s+)?(.+?)\s{2,}v\s+(.+?)\s{2,}(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?\s*$/);
    if (match && playedAt) rows.push({ leagueId: 203, home: match[1].trim(), away: match[2].trim(), home_score: Number(match[3]), away_score: Number(match[4]), home_ht: match[5] == null ? null : Number(match[5]), away_ht: match[6] == null ? null : Number(match[6]), playedAt, status: 'finished', source: 'OpenFootball' });
  }
  return rows;
}
async function requestWithTimeout(url, request = globalThis.fetch, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(url, { signal: controller.signal, headers: { 'User-Agent': 'IDDA-Analiz-Merkezi/1.4', Accept: 'text/csv, text/plain, application/json' } });
    if (!response.ok) throw new Error(`Geçmiş veri HTTP ${response.status}`);
    const body = await response.text();
    return { ok: true, status: response.status, text: async () => body, json: async () => JSON.parse(body) };
  }
  catch (error) { if (controller.signal.aborted) throw new Error('Geçmiş veri kaynağı zaman aşımına uğradı'); throw error; }
  finally { clearTimeout(timer); }
}
async function getText(url, request = globalThis.fetch) {
  const response = await requestWithTimeout(url, request);
  if (!response.ok) throw new Error(`Geçmiş veri HTTP ${response.status}`);
  return response.text();
}
async function footballDataHistory(leagueId, starts, request, warnings = []) {
  const settled = await Promise.allSettled(starts.map(async start => {
    try { return csvHistoryRows(await getText(footballDataHistoryUrl(leagueId, start), request), leagueId); }
    catch (primaryError) {
      warnings.push(`${start}-${start + 1} Football-Data.co.uk: ${primaryError.message}; arşiv/yedek kaynak deneniyor.`);
      const slug = FOOTBALL_DATA_ARCHIVE_SLUGS[Number(leagueId)];
      if (!slug) throw primaryError;
      const archiveUrl = `https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/${slug}/season-${footballDataSeasonCode(start)}.csv`;
      return csvHistoryRows(await getText(archiveUrl, request), leagueId).map(row => ({ ...row, source: 'Football-Data.co.uk (GitHub arşivi)' }));
    }
  }));
  settled.forEach((result, index) => { if (result.status === 'rejected') warnings.push(`${starts[index]}-${starts[index] + 1} geçmiş verisi alınamadı: ${result.reason.message}`); });
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
async function sportsDbHistory(leagueId, starts, request) {
  const externalId = SPORTS_DB_LEAGUES[Number(leagueId)];
  if (!externalId) return [];
  const settled = await Promise.allSettled(starts.map(async start => {
    const response = await requestWithTimeout(`${SPORTS_DB_BASE_URL}/eventsseason.php?id=${externalId}&s=${start}-${start + 1}`, request);
    if (!response.ok) throw new Error(`TheSportsDB geçmiş veri HTTP ${response.status}`);
    return sportsDbHistoryRows((await response.json()).events || [], leagueId);
  }));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
async function turkeyOpenFootballHistory(starts, request) {
  const settled = await Promise.allSettled(starts.map(async start => parseOpenFootball(await getText(`https://raw.githubusercontent.com/openfootball/europe/master/turkey/${start}-${String(start + 1).slice(-2)}_tr1.txt`, request))));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
async function espnCurrentHistory(leagueId, start, request) {
  const league = LEAGUES.find(item => item.id === leagueId);
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const response = await requestWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.espnSlug}/scoreboard?dates=${start}0701-${end}&limit=1000`, request);
  const payload = await response.json();
  return (payload.events || []).flatMap(event => {
    if (!event.status?.type?.completed) return [];
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find(item => item.homeAway === 'home'), away = competitors.find(item => item.homeAway === 'away');
    const homeScore = home?.score, awayScore = away?.score;
    if (!home?.team?.displayName || !away?.team?.displayName || homeScore == null || awayScore == null || homeScore === '' || awayScore === '' || !Number.isFinite(Number(homeScore)) || !Number.isFinite(Number(awayScore))) return [];
    return [{ leagueId, home: home.team.displayName, away: away.team.displayName, home_score: Number(homeScore), away_score: Number(awayScore), home_ht: null, away_ht: null, playedAt: event.date, status: 'finished', source: 'ESPN' }];
  });
}
function beforeMatch(rows, matchDate) {
  const limit = new Date(matchDate).getTime();
  if (!Number.isFinite(limit)) return rows;
  return rows.filter(row => !row.playedAt || new Date(row.playedAt).getTime() < limit);
}
async function fetchLeagueHistory(leagueId, date = new Date(), { request = globalThis.fetch, force = false } = {}) {
  const numericLeagueId = Number(leagueId);
  if (!FOOTBALL_DATA_UK_LEAGUES[numericLeagueId]) return [];
  const start = seasonStart(date), cacheKey = `history-${numericLeagueId}-${start}`;
  const cached = historyCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.time < (cached.rows.length ? HISTORY_CACHE_MS : 30000)) return beforeMatch(cached.rows, date);
  if (historyInFlight.has(cacheKey)) return beforeMatch(await historyInFlight.get(cacheKey), date);
  const operation = fetchAndCacheHistory(numericLeagueId, date, start, cacheKey, request);
  historyInFlight.set(cacheKey, operation);
  try { return beforeMatch(await operation, date); } finally { historyInFlight.delete(cacheKey); }
}
async function fetchAndCacheHistory(numericLeagueId, date, start, cacheKey, request) {
  const starts = [start, start - 1, start - 2, start - 3];
  const warnings = [];
  let rows = await footballDataHistory(numericLeagueId, starts, request, warnings);
  if (numericLeagueId === 203) rows.push(...await turkeyOpenFootballHistory(starts, request));
  else if (rows.length < 20) rows.push(...await sportsDbHistory(numericLeagueId, starts, request));
  if (start === seasonStart(new Date()) && !rows.some(row => row.playedAt && seasonStart(row.playedAt) === start)) {
    try { rows.push(...await espnCurrentHistory(numericLeagueId, start, request)); }
    catch (error) { warnings.push(`ESPN güncel sezon geçmişi alınamadı: ${error.message}`); }
  }
  const unique = [...new Map(rows.map(row => [`${row.leagueId}|${row.playedAt}|${canonicalTeamName(row.home)}|${canonicalTeamName(row.away)}`, row])).values()]
    .sort((left, right) => new Date(left.playedAt || 0) - new Date(right.playedAt || 0));
  historyWarnings.set(cacheKey, warnings);
  historyCache.set(cacheKey, { time: Date.now(), rows: unique });
  return unique;
}
function getHistoryWarnings(leagueId, date = new Date()) { return historyWarnings.get(`history-${Number(leagueId)}-${seasonStart(date)}`) || []; }
function clearHistoryCache() { historyCache.clear(); historyInFlight.clear(); historyWarnings.clear(); }

module.exports = { FOOTBALL_DATA_UK_LEAGUES, SPORTS_DB_LEAGUES, FOOTBALL_DATA_ARCHIVE_SLUGS, HISTORY_CACHE_MS, seasonStart, seasonLabel, footballDataSeasonCode, footballDataHistoryUrl, csvHistoryRows, sportsDbHistoryRows, parseOpenFootball, fetchLeagueHistory, getHistoryWarnings, clearHistoryCache };
