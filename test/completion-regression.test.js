'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sameTeam, normalizeStatus } = require('../fixture-providers/model');
const { csvHistoryRows, fetchLeagueHistory, clearHistoryCache } = require('../international-provider');
const { normalizeHistory } = require('../probability-engine');
const { buildCoupon, analyzeMatch } = require('../server');
const { enrichMatch } = require('../enrichment-provider');

test('gerçek kaynaklardaki takım kısaltmaları ve sponsorlar merkezi eşleşir', () => {
  for (const [a, b] of [['Nottingham Forest', "Nott'm Forest"], ['Celta Vigo', 'Celta'], ['Real Sociedad', 'Sociedad'], ['Espanyol', 'Espanol'], ['Borussia Dortmund', 'Dortmund'], ['Eintracht Frankfurt', 'Frankfurt'], ['Stade Rennais', 'Rennes'], ['İstanbul Başakşehir', 'Buyuksehyr'], ['Erzurumspor FK', 'BB Erzurumspor'], ['TÜMOSAN Konyaspor', 'Konyaspor'], ['RAMS Başakşehir FK', 'Istanbul Basaksehir'], ['Athletic Club', 'Ath Bilbao'], ['Atlético Madrid', 'Ath Madrid'], ["Borussia M'gladbach", "M'gladbach"], ['Inter Milan', 'Internazionale'], ['PSG', 'Paris Saint-Germain'], ['Köln', 'FC Koln']]) assert.equal(sameTeam(a, b), true, `${a} / ${b}`);
  for (const [a, b] of [['Inter', 'Inter Miami'], ['Real', 'Real Madrid'], ['United', 'Manchester United'], ['City', 'Hull City']]) assert.equal(sameTeam(a, b), false);
});

test('boş skor CSV ve modelde 0-0 sonucu oluşturmaz', () => {
  assert.equal(csvHistoryRows('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,01/08/2026,A,B,,', 39).length, 0);
  for (const missing of [null, '', undefined]) assert.equal(normalizeHistory([{ home: 'A', away: 'B', home_score: missing, away_score: missing, playedAt: '2026-08-01' }], '2026-09-01').length, 0);
});

test('eşzamanlı geçmiş istekleri indirmeyi paylaşır ve kendi tarihini uygular', async () => {
  clearHistoryCache();
  let calls = 0;
  const request = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { ok: true, status: 200, text: async () => 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,01/08/2026,A,B,1,0\nE0,20/08/2026,C,D,2,1' }; };
  const [early, late] = await Promise.all([fetchLeagueHistory(39, '2026-08-10', { request }), fetchLeagueHistory(39, '2026-09-01', { request })]);
  assert.equal(early.length, 1); assert.equal(late.length, 2);
  const count = calls;
  await fetchLeagueHistory(39, '2026-09-02', { request });
  assert.equal(calls, count);
});

test('ESPN ertelenmiş ve iptal maçları yaklaşan sayılmaz', () => {
  assert.equal(normalizeStatus('STATUS_POSTPONED'), 'POSTPONED');
  assert.equal(normalizeStatus('STATUS_CANCELED'), 'CANCELLED');
  assert.equal(normalizeStatus('STATUS_FINAL'), 'FINISHED');
});

test('Avrupa ESPN maç kimliği ile TFF kadrosu sorgulanmaz', async () => {
  const result = await enrichMatch({ id: 'espn:123456', provider: 'espn', leagueId: 39, home: 'Arsenal', away: 'Chelsea' });
  assert.deepEqual(result.sources, []);
});

test('yeni yükselen takımın yetersiz verisi arayüze karar olarak döner', async () => {
  const analysis = await analyzeMatch({ leagueId: 39, home: 'A', away: 'B', kickoffUtc: '2026-09-10' }, { europeanAnalysis: async () => ({ analysisReady: true, decision: 'VERİ YETERSİZ', matchedTeams: {}, decisionReasons: ['A iç saha geçmişi 0/3'] }), enrichmentProvider: async () => ({ injuries: { home: [], away: [] }, errors: [] }) });
  assert.equal(analysis.recommendation.action, 'VERİ YETERSİZ');
  assert.equal(analysis.recommendation.primary, null);
});

test('kupon gerçek model olasılığını korur, kapasite ve eleme ayrı sayılır', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ match: { id: String(i), home: `A${i}`, away: `B${i}` }, analysis: { decision: 'GÜÇLÜ SEÇENEK', dataQualityScore: i === 6 ? 20 : 70, recommendation: { primary: { market: '1X', confidence: 91.3, reason: 'Model' } } } }));
  for (const surprise of [false, true]) {
    const result = await buildCoupon(surprise, 'all', { collect: async () => rows });
    assert.equal(result.picks.length, surprise ? 3 : 5);
    assert.equal(result.picks[0].confidence, 91.3);
    assert.equal(result.eligible, 6); assert.equal(result.eliminated, 1);
    assert.equal(result.notSelected, surprise ? 3 : 1);
    assert.deepEqual(result.eliminationReasons, { 'Veri güveni düşük': 1 });
  }
});
