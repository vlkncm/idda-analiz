'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FixtureService, fixtureSettings, CACHE_SCHEMA_VERSION } = require('../fixture-service');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'idda-fixture-')); }
function settings(overrides = {}) { return { ...fixtureSettings({}), cacheMinutes: 60, refreshCooldownSeconds: 30, footballDataApiKey: 'x', ...overrides }; }
const cachedMatch = { id: 'test:1', provider: 'test', providerMatchId: '1', leagueId: 39, leagueName: 'Premier League', home: 'A', away: 'B', kickoffUtc: '2026-09-01T12:00:00Z' };

test('eski cache şeması otomatik geçersiz sayılır', async t => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'fixtures-cache.json'), JSON.stringify({ cacheVersion: 6, matches: [cachedMatch], updatedAt: '2026-08-30T11:30:00Z' }));
  let called = 0;
  const service = new FixtureService({ dataRoot: root, settings: settings(), now: () => new Date('2026-08-30T12:00:00Z'), manager: { fetchFixtures: async () => { called++; return { matches: [], providers: [], warnings: ['kaynak yok'], errors: [] }; } } });
  const result = await service.list({ range: '14' });
  assert.equal(called, 1); assert.equal(result.fromCache, false); assert.deepEqual(result.matches, []);
});
test('taze cache provider çağrısı yapmadan kullanılır', async t => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); let called = 0;
  fs.writeFileSync(path.join(root, 'fixtures-cache.json'), JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, matches: [cachedMatch], updatedAt: '2026-08-30T11:30:00Z', dateRange: { from: '2026-08-30', to: '2026-09-13' }, leagues: { '39': { provider: 'test', season: '2026-2027', count: 1 } }, providers: [], warnings: [], errors: [] }));
  const service = new FixtureService({ dataRoot: root, settings: settings(), now: () => new Date('2026-08-30T12:00:00Z'), manager: { fetchFixtures: async () => { called++; return { matches: [], providers: [], warnings: [], errors: [] }; } } });
  assert.equal((await service.getAll()).fromCache, true); assert.equal(called, 0);
});
test('arka arkaya zorla yenileme hız sınırına takılır', async t => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); let called = 0;
  const manager = { fetchFixtures: async () => { called++; return { matches: [cachedMatch], providers: [{ name: 'test' }], warnings: [], errors: [] }; } };
  const service = new FixtureService({ dataRoot: root, settings: settings(), now: () => new Date('2026-08-30T12:00:00Z'), manager });
  await service.getAll({ forceRefresh: true }); const second = await service.getAll({ forceRefresh: true });
  assert.equal(called, 1); assert.equal(second.fromCache, true); assert.match(second.warnings.join(' '), /kısa aralık/i);
});
test('eşzamanlı istekler aynı fikstür indirmesini paylaşır', async t => {
  const root=tempRoot();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let called=0;
  const manager={fetchFixtures:async()=>{called++;await new Promise(resolve=>setTimeout(resolve,10));return {matches:[cachedMatch],providers:[{name:'test',leagueId:39}],warnings:[],errors:[]};}};
  const service=new FixtureService({dataRoot:root,settings:settings(),now:()=>new Date('2026-08-30T12:00:00Z'),manager});
  const [first,second]=await Promise.all([service.getAll(),service.getAll()]);
  assert.equal(called,1);assert.deepEqual(first.matches,second.matches);
});
