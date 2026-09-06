'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LEAGUES, normalizeFixture, deduplicateFixtures, dateKeyInZone, rangeBounds, filterFixtures, seasonForDate, sameTeam } = require('../fixture-providers/model');

function match(overrides = {}) {
  const league = overrides.league || LEAGUES[1];
  return normalizeFixture({ providerMatchId: overrides.providerMatchId ?? '1', home: overrides.home ?? 'Manchester United FC', away: overrides.away ?? 'Arsenal', kickoffUtc: overrides.kickoffUtc ?? '2026-08-31T21:00:00Z', status: overrides.status ?? 'TIMED' }, { provider: overrides.provider || 'test', league, fetchedAt: '2026-08-30T10:00:00Z' });
}

test('altı desteklenen lig ortak modele dönüştürülür', () => {
  assert.equal(LEAGUES.length, 6);
  for (const [index, league] of LEAGUES.entries()) assert.equal(match({ league, providerMatchId: index + 1 }).leagueId, league.id);
});
test('aynı maç provider kimliği ve takım-saat anahtarıyla tekilleştirilir', () => {
  const a = match(), b = match({ provider: 'backup', providerMatchId: '99', home: 'Manchester United', kickoffUtc: '2026-08-31T21:05:00Z' });
  assert.equal(deduplicateFixtures([a, a, b]).length, 1);
});
test('Türkiye saat diliminde gece yarısı doğru güne geçer', () => {
  assert.equal(dateKeyInZone('2026-08-30T21:30:00Z'), '2026-08-31');
  assert.deepEqual(rangeBounds('tomorrow', new Date('2026-08-30T21:30:00Z')), { from: '2026-09-01', to: '2026-09-01' });
});
test('sezon başlangıcı Ağustos öncesi ve sonrası doğru hesaplanır', () => {
  assert.equal(seasonForDate('2026-06-01T12:00:00Z', LEAGUES[1]), '2025-2026');
  assert.equal(seasonForDate('2026-08-01T12:00:00Z', LEAGUES[1]), '2026-2027');
});
test('kontrollü takım alias sistemi çalışır ve farklı takımları eşleştirmez', () => {
  assert.equal(sameTeam('Fenerbahçe', 'Fenerbahce AS'), true);
  assert.equal(sameTeam('Manchester United', 'Manchester City'), false);
  const groups = [
    ['İstanbul Başakşehir', 'Istanbul Basaksehir', 'Buyuksehyr'], ['Erzurumspor FK', 'Erzurum BB', 'BB Erzurumspor', 'Erzurumspor'],
    ['TÜMOSAN Konyaspor', 'Konyaspor'], ['Athletic Club', 'Athletic Bilbao', 'Ath Bilbao'], ['Atlético Madrid', 'Atletico Madrid', 'Ath Madrid'],
    ["Borussia Mönchengladbach", "Borussia M'gladbach", "M'gladbach"], ['Inter', 'Inter Milan', 'Internazionale'], ['PSG', 'Paris Saint-Germain'], ['Köln', 'Cologne', 'FC Koln']
  ];
  for (const aliases of groups) for (const alias of aliases.slice(1)) assert.equal(sameTeam(aliases[0], alias), true, `${aliases[0]} != ${alias}`);
});
test('eksik takım veya tarih ortak modele alınmaz', () => {
  assert.throws(() => match({ home: '' }), /takım/i);
  assert.throws(() => match({ kickoffUtc: 'bozuk' }), /tarih/i);
});
test('lig ve bugün-yarın-14 gün filtreleri sunucu saatinden bağımsızdır', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const rows = [match({ providerMatchId: 'a', kickoffUtc: '2026-08-30T18:00:00Z' }), match({ providerMatchId: 'b', kickoffUtc: '2026-08-31T18:00:00Z' }), match({ providerMatchId: 'c', kickoffUtc: '2026-09-13T18:00:00Z' }), match({ providerMatchId: 'd', kickoffUtc: '2026-09-14T18:00:00Z' })];
  assert.equal(filterFixtures(rows, { range: 'today', now }).length, 1);
  assert.equal(filterFixtures(rows, { range: 'tomorrow', now }).length, 1);
  assert.equal(filterFixtures(rows, { range: '14', now }).length, 3);
  assert.equal(filterFixtures(rows, { range: '14', league: 39, now }).length, 3);
  assert.equal(filterFixtures(rows, { range: '14', league: 140, now }).length, 0);
});
test('geçmiş ve tamamlanmış maçlar yaklaşan listesine girmez', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const rows = [match({ providerMatchId:'past', kickoffUtc:'2026-08-30T10:00:00Z' }), match({ providerMatchId:'done', kickoffUtc:'2026-08-30T18:00:00Z', status:'FT' }), match({ providerMatchId:'future', kickoffUtc:'2026-08-30T18:00:00Z' })];
  assert.deepEqual(filterFixtures(rows,{range:'today',now}).map(row=>row.providerMatchId),['future']);
});
