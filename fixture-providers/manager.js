'use strict';

const { FixtureProviderError } = require('./base');
const { LEAGUES, deduplicateFixtures, dateKeyInZone } = require('./model');

class FixtureProviderManager {
  constructor({ providers, leagues = LEAGUES, logger = console, concurrency = 3, now = () => new Date() } = {}) {
    this.providers = providers || []; this.leagues = leagues; this.logger = logger;
    this.concurrency = Math.max(1, Math.min(3, concurrency)); this.now = now;
    this.health = Object.fromEntries(this.providers.map(provider => [provider.name, { name: provider.name, status: 'Bekliyor', lastSuccess: null, lastError: null, matchCount: 0, responseMs: null }]));
  }
  providerOrder(league) {
    const order = Number(league.id) === 203 ? ['espn', 'thesportsdb', 'tff', 'football-data.co.uk', 'api-football'] : ['espn', 'thesportsdb', 'football-data.org', 'football-data.co.uk', 'api-football'];
    const known = order.flatMap(name => this.providers.filter(provider => provider.name === name));
    const standard = new Set(['espn', 'api-football', 'tff', 'football-data.org', 'thesportsdb', 'football-data.co.uk']);
    return [...known, ...this.providers.filter(provider => !standard.has(provider.name))];
  }
  record(provider, { ok, count = 0, error = null, responseMs }) {
    const previous = this.health[provider.name] || { name: provider.name };
    this.health[provider.name] = { ...previous, status: ok ? 'Çalışıyor' : 'Hatalı', lastSuccess: ok ? this.now().toISOString() : previous.lastSuccess || null, lastError: ok ? null : String(error?.message || error || 'Bilinmeyen hata'), matchCount: count, responseMs };
  }
  async fetchLeague(league, { from, to, timezone, cachedMatches = [] }) {
    const matches = [], warnings = [], errors = [], providers = [];
    for (const provider of this.providerOrder(league)) {
      let available = false;
      try { available = await provider.isAvailable(league); } catch {}
      if (!available) continue;
      const started = Date.now();
      try {
        const rows = await provider.fetchFixtures({ league, from, to, timezone });
        if (!Array.isArray(rows)) throw new FixtureProviderError('Provider geçersiz sonuç döndürdü', { code: 'INVALID_PROVIDER_RESULT' });
        this.record(provider, { ok: true, count: rows.length, responseMs: Date.now() - started });
        for (const issue of provider.validationErrors || []) errors.push({ leagueId: league.id, leagueName: league.name, provider: provider.name, code: 'INVALID_FIXTURE', message: issue });
        if (provider.validationErrors?.length) warnings.push(`${league.name}: ${provider.validationErrors.length} eksik veya geçersiz kayıt gerçek maç listesine eklenmedi.`);
        if (provider.name === 'thesportsdb' && rows.length > 0 && rows.length < 2) warnings.push(`${league.name}: TheSportsDB olağan dışı düşük sayıda (${rows.length}) fikstür döndürdü.`);
        if (rows.length) { matches.push(...rows); providers.push({ name: provider.name, leagueId: league.id, leagueName: league.name, count: rows.length }); return { matches, warnings, errors, providers, stale: false }; }
        warnings.push(`${league.name}: ${provider.name} güncel fikstür döndürmedi; yedek kaynak denendi.`);
      } catch (error) {
        const code = error?.code || 'PROVIDER_ERROR'; this.record(provider, { ok: false, error, responseMs: Date.now() - started });
        warnings.push(`${league.name}: ${provider.name} kullanılamadı; yedek kaynak denendi.`);
        errors.push({ leagueId: league.id, leagueName: league.name, provider: provider.name, code, message: String(error?.message || 'Bilinmeyen provider hatası') });
        this.logger?.error?.('fixture_provider_error', { league: league.code, provider: provider.name, code, status: error?.status || null });
      }
    }
    const cached = cachedMatches.filter(match => Number(match.leagueId) === Number(league.id) && dateKeyInZone(match.kickoffUtc, timezone) >= from && dateKeyInZone(match.kickoffUtc, timezone) <= to);
    if (cached.length) {
      warnings.push(`${league.name}: Güncel kaynaklar başarısız; son başarılı önbellek (${cached[0].fetchedAt || 'tarih bilinmiyor'}) gösteriliyor.`);
      providers.push({ name: 'last-success-cache', leagueId: league.id, leagueName: league.name, count: cached.length });
      return { matches: cached, warnings, errors, providers, stale: true };
    }
    const attempted = Number(league.id) === 203 ? 'ESPN, TheSportsDB, TFF ve API-Football' : 'ESPN, TheSportsDB, football-data.org, Football-Data.co.uk ve API-Football';
    warnings.push(`${league.name}: Bu lig için güncel fikstür alınamadı. Son denenen kaynaklar: ${attempted}. Ayrıntılar için veri kaynağı durum ekranını kontrol edin.`);
    return { matches, warnings, errors, providers, stale: false };
  }
  async fetchFixtures({ from, to, timezone = 'Europe/Istanbul', cachedMatches = [] }) {
    const results = new Array(this.leagues.length); let next = 0;
    const worker = async () => { while (next < this.leagues.length) { const index = next++; results[index] = await this.fetchLeague(this.leagues[index], { from, to, timezone, cachedMatches }); } };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, this.leagues.length) }, worker));
    return { matches: deduplicateFixtures(results.flatMap(result => result.matches)), providers: results.flatMap(result => result.providers), warnings: [...new Set(results.flatMap(result => result.warnings))], errors: results.flatMap(result => result.errors), isStale: results.some(result => result.stale), health: this.getHealth() };
  }
  getHealth() { return Object.values(this.health); }
  getQuota() { return this.providers.find(provider => provider.name === 'api-football')?.quota || { provider: 'api-football', remaining: null, limit: null }; }
  async healthCheck() {
    for (const provider of this.providers.filter(item => ['espn', 'api-football', 'football-data.org', 'tff', 'thesportsdb'].includes(item.name))) {
      const started = Date.now();
      try { const result = await provider.healthCheck(); this.record(provider, { ok: Boolean(result?.ok), count: result?.count || 0, error: result?.error, responseMs: Date.now() - started }); }
      catch (error) { this.record(provider, { ok: false, error, responseMs: Date.now() - started }); }
    }
    return this.getHealth();
  }
}

module.exports = { FixtureProviderManager };
