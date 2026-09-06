'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiFootballProvider, fallbackSeason, statusCategory } = require('../fixture-providers/api-football');
const { FixtureProviderManager } = require('../fixture-providers/manager');
const { LEAGUES } = require('../fixture-providers/model');

function response(status, payload, headers = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: key => map.get(key.toLowerCase()) ?? null }, json: async () => payload };
}
function rawFixture(id, league, overrides = {}) {
  return { fixture: { id, date: '2026-09-01T20:00:00+03:00', timestamp: 1788282000, timezone: 'Europe/Istanbul', referee: 'Hakem', venue: { name: 'Stadyum', city: 'Şehir' }, status: { short: 'NS', long: 'Not Started' }, ...overrides.fixture }, league: { id: league.id, name: league.name, season: 2026, round: 'Regular Season - 1' }, teams: { home: { name: `Ev ${id}`, logo: 'home.png' }, away: { name: `Dep ${id}`, logo: 'away.png' }, ...overrides.teams }, goals: { home: null, away: null } };
}

test('API-Football altı lig için tek sezon keşfi ve altı fikstür isteği kullanır', async () => {
  const calls = [];
  const request = async url => {
    calls.push(url);
    if (url.includes('/leagues?')) return response(200, { response: LEAGUES.map(league => ({ league: { id: league.id }, seasons: [{ year: 2025, current: false }, { year: 2026, current: true }] })) });
    const id = Number(new URL(url).searchParams.get('league'));
    return response(200, { response: [rawFixture(id, LEAGUES.find(league => league.id === id))] });
  };
  const provider = new ApiFootballProvider({ apiKey: 'secret', request });
  const manager = new FixtureProviderManager({ providers: [provider], leagues: LEAGUES, logger: { error() {} } });
  const result = await manager.fetchFixtures({ from: '2026-08-31', to: '2026-09-14' });
  assert.equal(result.matches.length, 6); assert.equal(calls.filter(url => url.includes('/leagues?')).length, 1); assert.equal(calls.filter(url => url.includes('/fixtures?')).length, 6);
  assert.ok(calls.filter(url => url.includes('/fixtures?')).every(url => url.includes('season=2026') && url.includes('timezone=Europe%2FIstanbul')));
});

test('aktif sezon API current alanından seçilir ve temmuz fallback hesabı doğrudur', async () => {
  const provider = new ApiFootballProvider({ apiKey: 'x', request: async () => response(200, { response: [{ league: { id: 39 }, seasons: [{ year: 2026, current: true }] }] }) });
  assert.equal(await provider.fetchCurrentSeason(LEAGUES[1]), 2026);
  assert.equal(fallbackSeason(new Date('2026-06-30T12:00:00Z')), 2025); assert.equal(fallbackSeason(new Date('2026-07-01T12:00:00Z')), 2026);
});

test('API anahtarı eksikken provider çağrı yapmadan devre dışı kalır', async () => {
  let calls = 0; const provider = new ApiFootballProvider({ request: async () => { calls++; } });
  assert.equal(await provider.isConfigured(), false); assert.equal(await provider.isAvailable(), false); assert.equal(calls, 0);
});

test('HTTP 401 ve 403 tekrar denenmez', async () => {
  for (const status of [401, 403]) {
    let calls = 0; const provider = new ApiFootballProvider({ apiKey: 'x', request: async () => { calls++; return response(status, {}); } });
    await assert.rejects(() => provider.call('/status'), error => error.code === 'AUTH_ERROR'); assert.equal(calls, 1);
  }
});

test('HTTP 429 Retry-After değerine uyar ve en fazla iki kontrollü retry yapar', async () => {
  let calls = 0; const waits = [];
  const provider = new ApiFootballProvider({ apiKey: 'x', sleep: async ms => waits.push(ms), request: async () => { calls++; return calls < 3 ? response(429, {}, { 'retry-after': '2' }) : response(200, { response: [] }); } });
  await provider.call('/status'); assert.equal(calls, 3); assert.deepEqual(waits, [2000, 2000]);
});

test('kota başlıkları kaydedilir, anahtar URL ve sonuç modeline sızmaz', async () => {
  let captured;
  const provider = new ApiFootballProvider({ apiKey: 'TOP-SECRET', request: async (url, options) => { captured = { url, options }; return response(200, { response: [] }, { 'x-ratelimit-requests-remaining': 82, 'x-ratelimit-requests-limit': 100 }); } });
  await provider.call('/status'); assert.deepEqual(provider.quota, { provider: 'api-football', remaining: 82, limit: 100 }); assert.doesNotMatch(captured.url, /TOP-SECRET/); assert.doesNotMatch(JSON.stringify(provider.quota), /TOP-SECRET/); assert.equal(captured.options.headers['x-apisports-key'], 'TOP-SECRET');
});

test('normalizasyon Türkiye saati, durumlar ve eksik kayıtları doğru işler', async () => {
  const league = LEAGUES[1]; const provider = new ApiFootballProvider({ apiKey: 'x', now: () => new Date('2026-08-31T10:00:00Z') });
  const match = provider.normalizeFixture(rawFixture(1, league), league, 2026, '2026-08-31T10:00:00Z');
  assert.equal(match.id, 'api-football-1'); assert.equal(match.kickoffUtc, '2026-09-01T17:00:00.000Z'); assert.match(match.kickoffLocal, /01\.09\.2026/); assert.equal(match.demo, false);
  assert.deepEqual(['NS','TBD','1H','HT','2H','ET','BT','P','LIVE','FT','AET','PEN','PST','CANC','ABD','AWD','WO'].map(statusCategory), ['SCHEDULED','SCHEDULED','LIVE','LIVE','LIVE','LIVE','LIVE','LIVE','LIVE','FINISHED','FINISHED','FINISHED','POSTPONED','CANCELLED','SUSPENDED','FINISHED','FINISHED']);
  assert.throws(() => provider.normalizeFixture(rawFixture(2, league, { teams: { home: { name: '' } } }), league, 2026, ''), /eksik/i);
});

test('Avrupa ve Süper Lig fallback zincirleri lig bazında çalışır', async () => {
  const callOrder = [];
  const provider = (name, behavior) => ({ name, isAvailable: async league => name !== 'football-data.org' || league.id !== 203, fetchFixtures: async ({ league }) => { callOrder.push(`${league.id}:${name}`); return behavior(league); } });
  const api = provider('api-football', league => { if (league.id === 39 || league.id === 203) throw Object.assign(new Error('down'), { code: 'DOWN' }); return [{ id: `api-${league.id}`, provider: 'api-football', providerMatchId: league.id, leagueId: league.id, leagueName: league.name, home: 'A', away: 'B', kickoffUtc: '2026-09-01T12:00:00Z' }]; });
  const tff = provider('tff', league => league.id === 203 ? [{ id: 'tff-1', provider: 'tff', providerMatchId: 1, leagueId: 203, leagueName: league.name, home: 'C', away: 'D', kickoffUtc: '2026-09-01T13:00:00Z' }] : []);
  const fd = provider('football-data.org', league => [{ id: 'fd-1', provider: 'football-data.org', providerMatchId: 1, leagueId: league.id, leagueName: league.name, home: 'E', away: 'F', kickoffUtc: '2026-09-01T14:00:00Z' }]);
  const result = await new FixtureProviderManager({ providers: [api, tff, fd], leagues: [LEAGUES[0], LEAGUES[1], LEAGUES[2]], logger: { error() {} } }).fetchFixtures({ from: '2026-08-31', to: '2026-09-14' });
  assert.equal(result.matches.length, 3); assert.ok(callOrder.includes('203:tff')); assert.ok(callOrder.includes('39:football-data.org')); assert.ok(callOrder.includes('140:football-data.org')); assert.ok(!callOrder.includes('140:api-football'));
});
