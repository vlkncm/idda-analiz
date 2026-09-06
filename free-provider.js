'use strict';

const https = require('node:https');
const { sameTeam } = require('./fixture-providers/model');
const { fetchLeagueHistory } = require('./international-provider');
const { analyzeMatch: runProbabilityEngine } = require('./probability-engine');

const TFF_URL = 'https://www.tff.org/Default.aspx?pageId=198';
function getTff() { return new Promise((resolve, reject) => https.get(TFF_URL, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'IDDA-Analiz/1.4' } }, response => { if (response.statusCode !== 200) { response.resume(); return reject(new Error(`TFF ${response.statusCode}`)); } const chunks = []; response.on('error', reject); response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve(new TextDecoder('windows-1254').decode(Buffer.concat(chunks)))); }).on('error', reject)); }
function clean(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function slug(name) { return String(name || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-a-s$/, '').replace(/^arca-/, '').replace(/^corendon-/, ''); }
function parseTffFixtures(html) {
  return [...String(html || '').matchAll(/<tr class="haftaninMaclariTr">([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    const date = row.match(/lblTarih[^>]*>([^<]+)/i)?.[1], time = row.match(/lblSaat[^>]*>([^<]+)/i)?.[1] || '12:00', home = clean(row.match(/haftaninMaclariEv[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]), away = clean(row.match(/haftaninMaclariDeplasman[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]), matchId = row.match(/macId=(\d+)/i)?.[1];
    if (!date || !home || !away) return [];
    const [day, month, year] = date.split('.'), kickoffUtc = new Date(`${year}-${month}-${day}T${time}:00+03:00`).toISOString();
    return [{ id: `free-tff-${matchId || `${year}${month}${day}-${slug(home)}`}`, provider: 'tff', providerMatchId: matchId || `${year}${month}${day}-${slug(home)}`, leagueId: 203, leagueName: 'Süper Lig', home, away, date: kickoffUtc, kickoffUtc, status: 'SCHEDULED', venue: 'TFF maç merkezi', referee: 'Maç detayında açıklanır', homeScore: null, awayScore: null, demo: false, source: 'TFF', homeSlug: slug(home), awaySlug: slug(away), sourceUrl: matchId ? `https://www.tff.org/Default.aspx?pageId=29&macId=${matchId}` : TFF_URL, fetchedAt: new Date().toISOString() }];
  });
}
async function fetchTffMatches() { return parseTffFixtures(await getTff()); }
function historyStats(rows, name, venue) { return require('./international-analysis-provider').teamStats(rows, name, venue); }
async function freeAnalysis(match, { fetchHistory = fetchLeagueHistory } = {}) {
  const rows = await fetchHistory(203, new Date(match.kickoffUtc || match.date));
  const homeFound = rows.some(row => sameTeam(row.home, match.home) || sameTeam(row.away, match.home)), awayFound = rows.some(row => sameTeam(row.home, match.away) || sameTeam(row.away, match.away));
  const output = runProbabilityEngine({ match, rows });
  return { ...output, free: true, leagueId: 203, historySources: [...new Set(rows.map(row => row.source).filter(Boolean))], matchedTeams: { home: homeFound ? match.home : null, away: awayFound ? match.away : null }, limitations: [...(output.decisionReasons || []), ...(output.xg?.message ? [output.xg.message] : [])] };
}

const key = value => require('./fixture-providers/model').fold(require('./fixture-providers/model').canonicalTeamName(value));
module.exports = { key, fetchTffMatches, parseTffFixtures, historyStats, freeAnalysis };
