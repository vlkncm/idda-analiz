const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { buildAnalysis, summarizePlayers, makeRecommendation } = require('./analyzer');
const { fetchTffMatches, freeAnalysis } = require('./free-provider');
const { enrichMatch } = require('./enrichment-provider');

loadEnv();

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_ROOT = process.env.IDDA_DATA_DIR || path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA_ROOT, 'cache.json');
const SETTINGS_FILE = path.join(DATA_ROOT, 'settings.json');
const ANALYSIS_DIR = path.join(DATA_ROOT, 'analysis');
const PORT = Number(process.env.PORT || 4173);
const CACHE_MINUTES = Number(process.env.CACHE_MINUTES || 360);

const leagues = [
  { id: 203, name: 'Süper Lig', country: 'Türkiye', flag: '🇹🇷' },
  { id: 39, name: 'Premier League', country: 'İngiltere', flag: '🇬🇧' },
  { id: 140, name: 'La Liga', country: 'İspanya', flag: '🇪🇸' },
  { id: 78, name: 'Bundesliga', country: 'Almanya', flag: '🇩🇪' },
  { id: 135, name: 'Serie A', country: 'İtalya', flag: '🇮🇹' },
  { id: 61, name: 'Ligue 1', country: 'Fransa', flag: '🇫🇷' }
];

const demoMatches = [
  demo(203, 'Galatasaray', 'Beşiktaş', '2026-08-16T18:00:00+03:00', 74, 61, 58, ['Ev sahibi son 5 iç saha maçında yenilmedi.', 'Konuk takımın savunma rotasyonunda eksikler var.']),
  demo(203, 'Fenerbahçe', 'Trabzonspor', '2026-08-17T20:00:00+03:00', 69, 57, 63, ['İki takımın son karşılaşmalarında gol ortalaması yüksek.', 'Ev sahibinin ikinci yarı gol üretimi güçlü.']),
  demo(39, 'Arsenal', 'Liverpool', '2026-08-16T18:30:00+03:00', 55, 67, 71, ['İki takım da son 5 maçın 4’ünde gol buldu.', 'Tempo ve şut hacmi yüksek eşleşme.']),
  demo(140, 'Real Madrid', 'Valencia', '2026-08-16T22:00:00+03:00', 81, 54, 49, ['Ev sahibi iç sahada belirgin üstün.', 'Konuk takımın deplasman gol ortalaması düşük.']),
  demo(78, 'Bayern Münih', 'Dortmund', '2026-08-17T19:30:00+03:00', 64, 73, 76, ['Son H2H maçları yüksek gol eğilimli.', 'Her iki takımın hücum formu güçlü.']),
  demo(135, 'Inter', 'Juventus', '2026-08-17T21:45:00+03:00', 62, 48, 44, ['Savunma verileri lig ortalamasının üzerinde.', 'İlk yarı kontrollü oyun eğilimi var.']),
  demo(61, 'PSG', 'Lyon', '2026-08-18T21:45:00+03:00', 78, 68, 66, ['Ev sahibi hücum üretiminde üstün.', 'Konuk takım karşılıklı gol eğilimi taşıyor.'])
];

function demo(leagueId, home, away, date, homeScore, over25, btts, reasons) {
  return { id: `${leagueId}-${home}`, leagueId, home, away, date, status: 'NS', venue: 'Stadyum bilgisi', referee: 'Henüz atanmadı', homeScore, over25, btts, confidence: Math.round((homeScore + over25 + btts) / 30), reasons, demo: true };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { leagues, apiConfigured: Boolean(apiKey()), cacheMinutes: CACHE_MINUTES });
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req); const key = String(body.apiKey || '').trim();
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ apiKey: key }, null, 2));
      return json(res, 200, { ok: true, apiConfigured: Boolean(key) });
    }
    if (url.pathname === '/api/matches') {
      const league = url.searchParams.get('league') || 'all';
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getMatches(refresh);
      return json(res, 200, { ...data, matches: league === 'all' ? data.matches : data.matches.filter(m => String(m.leagueId) === league) });
    }
    if (url.pathname === '/api/analysis') {
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'Maç kimliği gerekli' });
      return json(res, 200, await getAnalysis(id, url.searchParams.get('refresh') === '1'));
    }
    if (url.pathname === '/api/coupon' && req.method === 'GET') return json(res, 200, await buildCoupon(url.searchParams.get('type')==='surprise'));
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });
    serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Sunucu hatası', detail: error.message });
  }
});

async function getMatches(forceRefresh) {
  if (process.env.USE_API_FOOTBALL !== 'true') return getFreeMatches();
  if (!apiKey()) return getFreeMatches();
  const cached = readCache();
  if (!forceRefresh && cached?.matches?.length && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_MINUTES * 60000) return cached;

  const from = isoDate(new Date());
  const end = new Date(); end.setDate(end.getDate() + 7);
  const to = isoDate(end);
  const season = seasonFor(new Date());
  const settled = await Promise.allSettled(leagues.map(l => api(`/fixtures?league=${l.id}&season=${season}&from=${from}&to=${to}&timezone=Europe%2FIstanbul`)));
  const matches = settled.flatMap((result, index) => result.status === 'fulfilled' ? result.value.response.map(f => normalizeFixture(f, leagues[index])) : []);
  if (!matches.length) return getFreeMatches(settled.filter(x => x.status === 'rejected').map(x => x.reason.message));
  const payload = { source: 'api-football', updatedAt: new Date().toISOString(), matches, warnings: settled.filter(x => x.status === 'rejected').map(x => x.reason.message) };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

async function api(endpoint) {
  const response = await fetch(`https://v3.football.api-sports.io${endpoint}`, { headers: { 'x-apisports-key': apiKey() } });
  if (!response.ok) throw new Error(`API-Football ${response.status}`);
  const body = await response.json();
  if (body.errors && Object.keys(body.errors).length) throw new Error(`API-Football: ${JSON.stringify(body.errors)}`);
  return body;
}

function normalizeFixture(f, league) {
  return {
    id: f.fixture.id, leagueId: league.id, home: f.teams.home.name, away: f.teams.away.name, homeId: f.teams.home.id, awayId: f.teams.away.id,
    homeLogo: f.teams.home.logo, awayLogo: f.teams.away.logo, date: f.fixture.date,
    status: f.fixture.status.short, venue: f.fixture.venue?.name || 'Belirtilmedi', referee: f.fixture.referee || 'Henüz atanmadı',
    homeScore: null, over25: null, btts: null, confidence: null,
    reasons: ['Ayrıntılı analiz motoru sonraki veri güncellemesinde hesaplanacak.'], demo: false
  };
}

function serveStatic(requestPath, res) {
  const relative = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return textResponse(res, 404, 'Bulunamadı');
  const ext = path.extname(file);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; } }
function apiKey() { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).apiKey || process.env.API_FOOTBALL_KEY || ''; } catch { return process.env.API_FOOTBALL_KEY || ''; } }
async function readBody(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 10000) throw new Error('İstek çok büyük'); } return raw ? JSON.parse(raw) : {}; }
async function getAnalysis(id, refresh) {
  if (String(id).startsWith('free-')) { const data=readCache();const match=data?.matches?.find(x=>String(x.id)===String(id));if(!match)throw new Error('Maç önbellekte bulunamadı');const [result,enrichment]=await Promise.all([freeAnalysis(match),enrichMatch(match)]);result.injuries=enrichment.injuries;result.lineup=enrichment.lineup;result.currentReferee=enrichment.referee;result.sources=enrichment.sources;result.enrichmentErrors=enrichment.errors;result.recommendation=makeRecommendation({...result,injuriesAvailable:enrichment.sources.some(x=>x.fields.includes('Sakat/cezalı'))});return result; }
  if (!apiKey()) return demoAnalysis(id);
  const safeId = String(id).replace(/\D/g, '');
  const file = path.join(ANALYSIS_DIR, `${safeId}.json`);
  if (!refresh && fs.existsSync(file)) { const cached = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - new Date(cached.generatedAt).getTime() < CACHE_MINUTES * 60000) return cached; }
  const fixture = (await api(`/fixtures?id=${safeId}`)).response[0];
  if (!fixture) throw new Error('Maç bulunamadı');
  const hid = fixture.teams.home.id, aid = fixture.teams.away.id;
  const [injuries, h2h, homeFixtures, awayFixtures] = await Promise.all([
    api(`/injuries?fixture=${safeId}`), api(`/fixtures/headtohead?h2h=${hid}-${aid}&last=10`),
    api(`/fixtures?team=${hid}&last=10&status=FT`), api(`/fixtures?team=${aid}&last=10&status=FT`)
  ]);
  const recent = [...homeFixtures.response.slice(0, 3), ...awayFixtures.response.slice(0, 3)];
  const playerResponses = await Promise.all(recent.map(f => api(`/fixtures/players?fixture=${f.fixture.id}`)));
  const result = buildAnalysis({ fixture, homeFixtures: homeFixtures.response, awayFixtures: awayFixtures.response, h2h: h2h.response, injuries: injuries.response, homePlayers: summarizePlayers(playerResponses, hid), awayPlayers: summarizePlayers(playerResponses, aid) });
  result.recommendation = makeRecommendation({...result,injuriesAvailable:true});
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(result, null, 2)); return result;
}
async function analyzeCouponMatches(){
  const data=await getMatches(false),matches=data.matches.filter(x=>new Date(x.date).getTime()>=Date.now()-3*60*60*1000),rows=[];
  for(let i=0;i<matches.length;i+=3){const batch=matches.slice(i,i+3);const results=await Promise.all(batch.map(async match=>{try{return{match,analysis:await getAnalysis(match.id,false)}}catch(error){return{match,error:error.message}}}));rows.push(...results)}
  return rows;
}
async function buildCoupon(surprise=false){
  const rows=await analyzeCouponMatches();
  if(surprise){const candidates=rows.flatMap(({match,analysis})=>{if(!analysis?.scores||Number(analysis.scores.confidence)<65||Number(analysis.h2h?.played||0)<3)return[];const s=analysis.scores,options=[];if(s.homeAdvantage>=45&&s.homeAdvantage<=55)options.push({selection:'Maç sonucu X',confidence:Math.round(59-Math.abs(50-s.homeAdvantage)*.8),reason:`Ev/deplasman dengesi %${s.homeAdvantage}–%${100-s.homeAdvantage}; beraberlik sürprizi değerlendirildi.`});if(s.homeAdvantage>=56&&s.homeAdvantage<=63)options.push({selection:'Maç sonucu 1',confidence:Math.round(s.homeAdvantage-3),reason:`Ev sahibi yönü %${s.homeAdvantage}; daha riskli doğrudan galibiyet seçildi.`});if(s.homeAdvantage>=37&&s.homeAdvantage<=44)options.push({selection:'Maç sonucu 2',confidence:Math.round(97-s.homeAdvantage),reason:`Deplasman yönü %${100-s.homeAdvantage}; daha riskli doğrudan galibiyet seçildi.`});if(s.over25>=54&&s.over25<62)options.push({selection:'2,5 Üst',confidence:s.over25,reason:`Gol eğilimi sınırda: %${s.over25}.`});if(s.btts>=54&&s.btts<62)options.push({selection:'KG Var',confidence:s.btts,reason:`Karşılıklı gol eğilimi sınırda: %${s.btts}.`});const pick=options.sort((a,b)=>b.confidence-a.confidence)[0];return pick?[{matchId:match.id,home:match.home,away:match.away,date:match.date,...pick,lineupConfirmed:Boolean(analysis.lineup?.confirmed),sources:(analysis.sources||[]).map(x=>x.name)}]:[]}).sort((a,b)=>b.confidence-a.confidence).slice(0,3);return{type:'surprise',generatedAt:new Date().toISOString(),analyzed:rows.length,picks:candidates,complete:candidates.length===3,headline:candidates.length?`${candidates.length} sürpriz seçim bulundu`:'Uygun sürpriz seçim bulunamadı',warning:'Sürpriz kupon yüksek risklidir ve oran verisi kullanılmaz. Toplam en fazla 0,25 birim düşün; sonuç veya kazanç garantisi yoktur.'};}
  const candidates=rows.flatMap(({match,analysis})=>{if(!analysis?.recommendation?.primary)return[];const p=analysis.recommendation.primary,dataConfidence=Number(analysis.scores?.confidence||0),h2h=Math.min(Number(analysis.h2h?.played||0),8),lineupBonus=analysis.lineup?.confirmed?4:0,sourceBonus=(analysis.sources?.length||0)>=2?3:0;const confidence=Math.round(p.confidence*.62+dataConfidence*.28+h2h*.5+lineupBonus+sourceBonus);if(p.confidence<62||dataConfidence<65||confidence<67)return[];return[{matchId:match.id,home:match.home,away:match.away,date:match.date,selection:p.market,confidence:Math.min(confidence,89),reason:p.reason,lineupConfirmed:Boolean(analysis.lineup?.confirmed),sources:(analysis.sources||[]).map(x=>x.name)}]}).sort((a,b)=>b.confidence-a.confidence).slice(0,5);
  return{generatedAt:new Date().toISOString(),analyzed:rows.length,picks:candidates,complete:candidates.length===5,headline:candidates.length?`En güçlü ${candidates.length} seçim bulundu`:'Güven eşiğini geçen maç bulunamadı',warning:'Kesin kazanan maç yoktur. Liste yalnızca mevcut verilerde en güçlü istatistiksel seçimleri gösterir; 5 seçimi doldurmak için eşik düşürülmez.'};
}
async function getFreeMatches(previousWarnings=[]) { try { const matches=await fetchTffMatches();const payload={source:'tff-sportscore',updatedAt:new Date().toISOString(),matches,warnings:previousWarnings};fs.mkdirSync(path.dirname(CACHE_FILE),{recursive:true});fs.writeFileSync(CACHE_FILE,JSON.stringify(payload,null,2));return payload; } catch(error) { return {source:'demo',updatedAt:new Date().toISOString(),matches:demoMatches,warnings:[...previousWarnings,error.message]}; } }
function demoAnalysis(id) {
  const m = demoMatches.find(x => String(x.id) === String(id)) || demoMatches[0];
  return { demo: true, home: { played:5,wins:4,draws:1,losses:0,goalsForAvg:2.2,goalsAgainstAvg:.8,firstHalfAvg:.8,secondHalfAvg:1.4,over25:m.over25,btts:m.btts,form:'WWDWW' }, away: { played:5,wins:2,draws:1,losses:2,goalsForAvg:1.4,goalsAgainstAvg:1.3,firstHalfAvg:.5,secondHalfAvg:.9,over25:m.over25-5,btts:m.btts,form:'WLDWL' }, h2h: { played:8,homeWins:4,draws:2,awayWins:2,goalsAvg:2.75,over25:m.over25 }, injuries: { home:[{name:'Örnek oyuncu',reason:'Kas sakatlığı'}],away:[] }, players: { home:[{name:'Örnek forvet',rating:7.6,minutes:258,goals:3,assists:1}],away:[{name:'Örnek orta saha',rating:7.2,minutes:270,goals:1,assists:2}] }, referee: { home:{referee:m.referee,matches:2,wins:1,draws:1,losses:0},away:{referee:m.referee,matches:1,wins:0,draws:0,losses:1} }, scores: { homeAdvantage:m.homeScore,over25:m.over25,btts:m.btts,firstHalf:57,secondHalf:72,confidence:m.confidence*10 }, generatedAt:new Date().toISOString() };
}
function isoDate(date) { return date.toISOString().slice(0, 10); }
function seasonFor(date) { return date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear(); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function textResponse(res, status, body) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); }
function loadEnv() { const file = path.join(__dirname, '.env'); if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } }

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`İDDA Analiz: http://127.0.0.1:${PORT}`));
}

function startServer(port = PORT) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }); }
module.exports = { seasonFor, leagues, startServer, server };
