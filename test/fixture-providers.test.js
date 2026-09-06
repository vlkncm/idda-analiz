'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FixtureProviderManager } = require('../fixture-providers/manager');
const { FixtureProviderError } = require('../fixture-providers/base');
const { FootballDataOrgProvider } = require('../fixture-providers/football-data-org');
const { TheSportsDbProvider } = require('../fixture-providers/the-sports-db');
const { EspnFixtureProvider } = require('../fixture-providers/espn');
const { TffFixtureProvider } = require('../fixture-providers/tff');
const { FootballDataUkFixtureProvider, parseCsv, zonedLocalToUtc } = require('../fixture-providers/football-data-uk');
const { LEAGUES } = require('../fixture-providers/model');
const { parseJson, isPrivateIp, fetchResource } = require('../fixture-providers/http');

const fdRow = { id: 7, utcDate: '2026-09-01T19:00:00Z', status: 'TIMED', homeTeam: { name: 'Team A' }, awayTeam: { name: 'Team B' }, season: { startDate: '2026-08-01', endDate: '2027-05-30' } };

test('ESPN altı ligde birincil anahtarsız fikstür kaynağıdır ve geçmişi ayıklar', async () => {
  for (const league of LEAGUES) {
    const event = at => ({ id:`${league.id}-${at}`,date:at,status:{type:{state:'pre',completed:false,name:'STATUS_SCHEDULED'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Home'}},{homeAway:'away',team:{displayName:'Away'}}]}] });
    const provider = new EspnFixtureProvider({now:()=>new Date('2026-09-01T10:00:00Z'),request:async()=>({events:[event('2026-09-02T18:00:00Z'),event('2026-08-30T18:00:00Z')]})});
    const rows=await provider.fetchFixtures({league,from:'2026-08-30',to:'2026-09-13'});
    assert.equal(rows.length,1); assert.equal(rows[0].provider,'espn'); assert.equal(rows[0].leagueId,league.id);
  }
});

test('football-data.org desteklediği beş Avrupa liginde gerçek şemayı normalize eder', async () => {
  for (const league of LEAGUES.filter(x => x.footballDataCode)) {
    const provider = new FootballDataOrgProvider({ apiKey: 'secret', request: async () => ({ matches: [{ ...fdRow, id: league.id }] }) });
    const rows = await provider.fetchFixtures({ league, from: '2026-08-30', to: '2026-09-13' });
    assert.equal(rows[0].leagueId, league.id); assert.equal(rows[0].provider, 'football-data.org'); assert.equal(rows[0].demo, false);
  }
});
test('TFF provider Süper Lig kaydını ortak modele dönüştürür', async () => {
  const provider = new TffFixtureProvider({ fetchMatches: async () => [{ id: 'free-tff-8', home: 'Fenerbahçe', away: 'Galatasaray', date: '2026-09-01T17:00:00Z' }] });
  const rows = await provider.fetchFixtures({ league: LEAGUES[0], from: '2026-08-30', to: '2026-09-13' });
  assert.equal(rows[0].source, 'TFF'); assert.equal(rows[0].leagueId, 203);
});
test('Football-Data.co.uk haftalık CSV tüm desteklenen ligleri ve yerel saatleri normalize eder', async () => {
  const divisions = ['T1', 'E0', 'SP1', 'D1', 'I1', 'F1'];
  const csv = `Div,Date,Time,HomeTeam,AwayTeam\n${divisions.map((div, index) => `${div},01/09/2026,20:00,"Home, ${index}",Away ${index}`).join('\n')}`;
  const provider = new FootballDataUkFixtureProvider({ request: async () => csv });
  for (const league of LEAGUES) {
    const rows = await provider.fetchFixtures({ league, from: '2026-08-30', to: '2026-09-13' });
    assert.equal(rows.length, 1); assert.equal(rows[0].provider, 'football-data.co.uk'); assert.match(rows[0].home, /Home,/);
  }
  assert.equal(zonedLocalToUtc('01/09/2026', '20:00', 'Europe/Istanbul'), '2026-09-01T17:00:00.000Z');
});
test('TheSportsDB bozuk kayıtları göstermez ve sezon/next yanıtını tekilleştirir', async () => {
  const event = { idEvent: '9', dateEvent: '2026-09-02', strTime: '18:00:00', strHomeTeam: 'Club One', strAwayTeam: 'Club Two' };
  const provider = new TheSportsDbProvider({ request: async () => ({ events: [event, { idEvent: 'bad', dateEvent: null, strHomeTeam: '', strAwayTeam: '' }] }) });
  const rows = await provider.fetchFixtures({ league: LEAGUES[1], from: '2026-08-30', to: '2026-09-13' });
  assert.equal(rows.length, 1); assert.equal(rows[0].providerMatchId, '9');
});
test('provider başarısız olunca yedeğe geçilir, 429 ve timeout raporlanır', async () => {
  const failed = { name: 'primary', isAvailable: async () => true, fetchFixtures: async () => { throw new FixtureProviderError('HTTP 429', { code: 'RATE_LIMIT', status: 429 }); } };
  const backup = { name: 'backup', isAvailable: async () => true, fetchFixtures: async ({ league }) => [{ provider: 'backup', providerMatchId: String(league.id), id: `backup:${league.id}`, leagueId: league.id, leagueName: league.name, home: 'A', away: 'B', kickoffUtc: '2026-09-01T12:00:00Z' }] };
  const manager = new FixtureProviderManager({ providers: [failed, backup], leagues: [LEAGUES[1]], logger: { error() {} } });
  const result = await manager.fetchFixtures({ from: '2026-08-30', to: '2026-09-13' });
  assert.equal(result.matches.length, 1); assert.equal(result.errors[0].code, 'RATE_LIMIT'); assert.equal(result.providers[0].name, 'backup');
});
test('bütün providerlar başarısızsa demo maç üretilmez', async () => {
  const failed = { name: 'timeout', isAvailable: async () => true, fetchFixtures: async () => { throw new FixtureProviderError('timeout', { code: 'TIMEOUT' }); } };
  const result = await new FixtureProviderManager({ providers: [failed], leagues: [LEAGUES[1]], logger: { error() {} } }).fetchFixtures({ from: '2026-08-30', to: '2026-09-13' });
  assert.deepEqual(result.matches, []); assert.equal(result.errors[0].code, 'TIMEOUT'); assert.match(result.warnings.join(' '), /alınamadı/i);
});
test('bozuk JSON ve HTML JSON gibi kabul edilmez', () => {
  assert.throws(() => parseJson('{broken'), error => error.code === 'INVALID_JSON');
  assert.throws(() => parseJson('<html>no fixture</html>'), error => error.code === 'INVALID_JSON');
});
test('bozuk HTML, CSV fikstürü gibi kabul edilmez', () => assert.throws(() => parseCsv('<html>broken</html>'), error => error.code === 'INVALID_CSV'));
test('localhost ve özel IP aralıkları engellenir', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.1.1', '::1']) assert.equal(isPrivateIp(address), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});
test('provider redirect hedefi tekrar güvenlik denetiminden geçer', async () => {
  const lookup = async host => [{ address: host === '127.0.0.1' ? '127.0.0.1' : '93.184.216.34' }];
  const headers = value => ({ get: key => key.toLowerCase() === 'location' ? value : null });
  const request = async () => ({ status: 302, ok: false, headers: headers('http://127.0.0.1/private') });
  await assert.rejects(() => fetchResource('http://example.com/matches', { allowHttp: true, allowedDomains: ['example.com', '127.0.0.1'], lookup, request }), error => error.code === 'PRIVATE_ADDRESS');
});
test('kaynak yanıtı boyut ve timeout sınırlarına uyar', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }];
  const large = async () => ({ status: 200, ok: true, headers: { get: key => key === 'content-length' ? '5000' : null }, text: async () => 'x' });
  await assert.rejects(() => fetchResource('https://example.com/data', { allowedDomains: ['example.com'], lookup, request: large, maxBytes: 100 }), error => error.code === 'RESPONSE_TOO_LARGE');
  const hanging = async (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(() => fetchResource('https://example.com/data', { allowedDomains: ['example.com'], lookup, request: hanging, timeoutMs: 5 }), error => error.code === 'TIMEOUT');
});
