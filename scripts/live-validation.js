'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { FixtureService, fixtureSettings } = require('../fixture-service');
const { LEAGUES } = require('../fixture-providers/model');
const { fetchLeagueHistory, getHistoryWarnings } = require('../international-provider');
const { analyzeMatch, startServer, server, buildCoupon } = require('../server');
const { internationalAnalysis } = require('../international-analysis-provider');

async function main() {
  const service = new FixtureService({ dataRoot: path.join(__dirname, '..', 'data'), settings: fixtureSettings() });
  const fixtures = await service.getAll({ forceRefresh: true });
  const historyEntries = await Promise.all(LEAGUES.map(async league => {
    const leagueMatches = fixtures.matches.filter(match => Number(match.leagueId) === league.id);
    const asOf = leagueMatches.length ? new Date(Math.max(...leagueMatches.map(match => new Date(match.kickoffUtc).getTime()))) : new Date();
    return [league.id, await fetchLeagueHistory(league.id, asOf).catch(() => [])];
  }));
  const histories = new Map(historyEntries);
  const validationMatches = fixtures.matches;
  const results = [];
  const couponRows = [];
  for (const match of validationMatches) {
    try {
      const provider = item => internationalAnalysis(item, { fetchHistory: async () => histories.get(Number(item.leagueId)) || [] });
      const analysis = await analyzeMatch(match, { turkeyAnalysis: provider, europeanAnalysis: provider });
      if (analysis.probabilities) {
        const p = analysis.probabilities;
        for (const total of [p.home + p.draw + p.away, p.over25 + p.under25, p.bttsYes + p.bttsNo]) assert.ok(Math.abs(total - 100) <= 0.2, `Olasılık toplamı: ${total}`);
      }
      couponRows.push({ match, analysis });
      results.push({ match: `${match.home} - ${match.away}`, league: match.leagueName, decision: analysis.decision, selection: analysis.primarySelection?.market || null, probability: analysis.primarySelection?.probability || null, dataConfidence: analysis.dataQualityScore, reason: analysis.decisionReasons?.join('; ') || null });
    } catch (error) {
      results.push({ match: `${match.home} - ${match.away}`, league: match.leagueName, decision: 'ANALİZ HATASI', reason: error.message });
    }
  }
  const counts = Object.fromEntries(LEAGUES.map(league => [league.name, fixtures.matches.filter(match => Number(match.leagueId) === league.id).length]));
  const decisions = results.reduce((summary, row) => ({ ...summary, [row.decision]: (summary[row.decision] || 0) + 1 }), {});
  const selections = results.filter(row => row.selection).reduce((summary, row) => ({ ...summary, [row.selection]: (summary[row.selection] || 0) + 1 }), {});
  const failures = results.filter(row => !row.selection);
  const historyCounts = Object.fromEntries(LEAGUES.map(league => [league.name, histories.get(league.id)?.length || 0]));
  const coupon = await buildCoupon(false, 'all', { collect: async () => couponRows });
  const port = await startServer(0);
  let runtime;
  try { runtime = await fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.json()); }
  finally { await new Promise(resolve => server.close(resolve)); }
  const historySourceWarnings = Object.fromEntries(LEAGUES.map(league => [league.name, getHistoryWarnings(league.id)]));
  const report = { generatedAt: new Date().toISOString(), runtime, totalFixtures: fixtures.matches.length, leagueCounts: counts, historyCounts, historySourceWarnings, analyzed: results.length, decisions, selections, failures, results, coupon, providers: fixtures.providers, sourceWarnings: fixtures.warnings, sourceErrors: fixtures.errors };
  fs.mkdirSync(path.join(__dirname, '..', 'validation'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'validation', 'live-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  assert.ok(results.length >= 30, `Canlı doğrulamada ${results.length} maç incelendi; en az 30 gerekli.`);
  assert.ok(results.filter(row => row.selection).length >= 30, 'En az 30 gerçek maç için seçenek doğrulanmalı.');
  assert.ok(LEAGUES.every(league => counts[league.name] > 0 && historyCounts[league.name] > 0), 'Her ligde canlı fikstür ve geçmiş veri gerekli.');
  assert.ok(!fixtures.isStale && fixtures.providers.every(row => row.name !== 'last-success-cache'), 'Eski önbellek canlı doğrulama sayılmaz.');
  assert.ok(!results.some(row => row.decision === 'ANALİZ HATASI'), 'Analiz sırasında hata oluştu.');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
