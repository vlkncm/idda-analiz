'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { assessAbsences } = require('./probability-engine');
const { freeAnalysis } = require('./free-provider');
const { internationalAnalysis } = require('./international-analysis-provider');
const { enrichMatch } = require('./enrichment-provider');
const { FixtureService, fixtureSettings } = require('./fixture-service');
const { LEAGUES, sameTeam } = require('./fixture-providers/model');

loadEnv();

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_ROOT = process.env.IDDA_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4173);
const settings = fixtureSettings();
const fixtureService = new FixtureService({ dataRoot: DATA_ROOT, settings });
const leagues = LEAGUES;
const VALID_RANGES = new Set(['today', 'tomorrow', 'week', '14']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        leagues,
        lookaheadDays: settings.lookaheadDays,
        cacheMinutes: settings.cacheMinutes,
        dateRanges: [
          { id: 'today', name: 'Bugün' }, { id: 'tomorrow', name: 'Yarın' },
          { id: 'week', name: 'Bu hafta' }, { id: '14', name: 'Önümüzdeki 14 gün' }
        ]
      });
    }
    if (url.pathname === '/api/matches' && req.method === 'GET') {
      const league = url.searchParams.get('league') || 'all';
      const range = url.searchParams.get('range') || '14';
      validateFilters(league, range);
      return json(res, 200, await fixtureService.list({ league, range, forceRefresh: url.searchParams.get('refresh') === '1' }));
    }
    if (url.pathname === '/api/analysis' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) throw new HttpError(400, 'Maç kimliği gerekli');
      return json(res, 200, await getAnalysis(id));
    }
    if (url.pathname === '/api/coupon' && req.method === 'GET') {
      const league = url.searchParams.get('league') || 'all';
      validateFilters(league, '14');
      return json(res, 200, await buildCoupon(url.searchParams.get('type') === 'surprise', league));
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version: require('./package.json').version, engine: 'node-dixon-coles-elo-v1', codeRoot: ROOT });
    serveStatic(url.pathname, res);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('server_error', { name: error.name, message: error.message });
    json(res, status, { error: status >= 500 ? 'Sunucu hatası' : error.message, code: error.code, detail: status >= 500 ? undefined : error.message, diagnostic: status >= 500 ? undefined : error.diagnostic });
  }
});

function validateFilters(league, range) {
  if (league !== 'all' && !leagues.some(item => String(item.id) === String(league))) throw new HttpError(400, 'Geçersiz lig');
  if (!VALID_RANGES.has(range)) throw new HttpError(400, 'Geçersiz tarih aralığı');
}

function serveStatic(requestPath, res) {
  const relative = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, relative);
  if ((!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return textResponse(res, 404, 'Bulunamadı');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function findMatch(id) {
  const matches = (await fixtureService.getAll()).matches;
  const match = matches.find(item => String(item.id) === String(id));
  if (!match) throw new HttpError(404, 'Maç güncel fikstür önbelleğinde bulunamadı');
  return match;
}

async function getAnalysis(id) {
  const match = await findMatch(id);
  return analyzeMatch(match);
}

async function analyzeMatch(match, { turkeyAnalysis = freeAnalysis, europeanAnalysis = internationalAnalysis, enrichmentProvider = enrichMatch } = {}) {
  const analysis = Number(match.leagueId) === 203 ? await turkeyAnalysis(match) : await europeanAnalysis(match);
  if (!analysis.analysisReady || (analysis.decision !== 'VERİ YETERSİZ' && (!sameTeam(match.home, analysis.matchedTeams?.home) || !sameTeam(match.away, analysis.matchedTeams?.away)))) throw new HttpError(422, 'Analiz için yeterli geçmiş veri bulunamadı.');
  const enrichment = await Promise.resolve().then(() => enrichmentProvider(match)).catch(error => ({ injuries: { home: [], away: [] }, lineup: null, referee: null, sources: [], errors: [error.message] }));
  analysis.injuries = enrichment.injuries;
  analysis.lineup = enrichment.lineup;
  analysis.currentReferee = enrichment.referee;
  analysis.sources = enrichment.sources;
  analysis.enrichmentErrors = enrichment.errors;
  analysis.absences = assessAbsences(enrichment.injuries);
  analysis.missingDataWarnings = [...new Set([...(analysis.missingDataWarnings || []), ...require('./international-provider').getHistoryWarnings(match.leagueId, match.kickoffUtc || match.date), ...(enrichment.errors || [])])];
  analysis.recommendation = recommendationFromModel(analysis);
  return analysis;
}

function recommendationFromModel(analysis) {
  const primary = analysis.primarySelection ? { market: analysis.primarySelection.market, confidence: analysis.primarySelection.probability, dataConfidence: analysis.primarySelection.dataConfidence, usedMatches: analysis.primarySelection.usedMatches, reason: analysis.primarySelection.reason } : null;
  return { action: analysis.decision, primary, alternatives: analysis.alternativeSelections || [], picks: primary ? [primary] : [], warnings: [...(analysis.decisionReasons || []), ...(analysis.missingDataWarnings || [])], risk: analysis.riskLevel || 'Yüksek', stake: 'Bahis miktarı önerilmez' };
}

async function analyzeCouponMatches(league = 'all', { service = fixtureService, analyze = getAnalysis } = {}) {
  const payload = await service.list({ league, range: '14' });
  const matches = payload.matches.filter(match => (match.statusCategory || match.status) === 'SCHEDULED');
  const rows = [];
  for (let index = 0; index < matches.length; index += 3) {
    const batch = matches.slice(index, index + 3);
    rows.push(...await Promise.all(batch.map(async match => {
      try { return { match, analysis: await analyze(match.id) }; }
      catch (error) { return { match, error: error.message }; }
    })));
  }
  return rows;
}

async function buildCoupon(surprise = false, league = 'all', { collect = analyzeCouponMatches } = {}) {
  const rows = await collect(league);
  const candidates = rows.flatMap(({ match, analysis }) => {
    const primary = analysis?.recommendation?.primary;
    if (!primary || primary.confidence < 58 || Number(analysis.dataQualityScore || 0) < 50 || analysis.decision === 'YÜKSEK RİSK') return [];
    return [{ matchId: match.id, home: match.home, away: match.away, date: match.kickoffUtc, selection: primary.market, confidence: primary.confidence, dataConfidence: analysis.dataQualityScore, reason: primary.reason, lineupConfirmed: Boolean(analysis.lineup?.confirmed), sources: (analysis.sources || []).map(source => source.name) }];
  }).sort((a, b) => b.confidence - a.confidence);
  const limit = surprise ? 3 : 5;
  const picks = candidates.filter((pick, index) => candidates.findIndex(other => other.matchId === pick.matchId) === index).slice(0, limit);
  const eliminated = rows.length - candidates.length;
  const eliminationReasons = rows.flatMap(row => row.error ? [row.error] : !row.analysis?.recommendation?.primary ? ['Uygun geçmiş veri yok'] : Number(row.analysis.dataQualityScore || 0) < 50 ? ['Veri güveni düşük'] : row.analysis.decision === 'YÜKSEK RİSK' ? ['Risk seviyesi yüksek'] : row.analysis.recommendation.primary.confidence < 58 ? ['Seçim olasılığı eşik altında'] : []).reduce((map, reason) => ({ ...map, [reason]: (map[reason] || 0) + 1 }), {});
  return { type: surprise ? 'surprise' : 'standard', generatedAt: new Date().toISOString(), analyzed: rows.length, eligible: candidates.length, notSelected: candidates.length - picks.length, eliminated, eliminationReasons, picks, complete: picks.length === limit, headline: picks.length ? `En güçlü ${picks.length} seçenek bulundu` : 'Güven eşiğini geçen maç bulunamadı', warning: 'Kesin maç veya garanti sonuç yoktur; liste yalnız istatistiksel değerlendirmedir.' };
}

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function textResponse(res, status, body) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); }
function loadEnv() {
  const candidates = [process.env.IDDA_ENV_FILE, path.join(process.cwd(), '.env'), path.join(__dirname, '.env')].filter(Boolean);
  const file = [...new Set(candidates)].find(candidate => fs.existsSync(candidate));
  if (!file) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`İDDA Analiz: http://127.0.0.1:${PORT}`));
function startServer(port = PORT) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }); }

module.exports = { leagues, startServer, server, fixtureService, findMatch, analyzeMatch, getAnalysis, analyzeCouponMatches, buildCoupon };
