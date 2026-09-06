'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FixtureProvider, FixtureProviderError } = require('./base');
const { dateKeyInZone } = require('./model');

const SEASON_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);
const FINISHED = new Set(['FT', 'AET', 'PEN']);

function fallbackSeason(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() + 1 >= 7 ? year : year - 1;
}

function statusCategory(status) {
  if (status === 'NS' || status === 'TBD') return 'SCHEDULED';
  if (LIVE.has(status)) return 'LIVE';
  if (FINISHED.has(status) || status === 'AWD' || status === 'WO') return 'FINISHED';
  if (status === 'PST') return 'POSTPONED';
  if (status === 'CANC') return 'CANCELLED';
  if (status === 'ABD') return 'SUSPENDED';
  return status || 'UNKNOWN';
}

function localDateTime(iso, timeZone) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(value);
}

class ApiFootballProvider extends FixtureProvider {
  constructor({ apiKey, baseUrl = 'https://v3.football.api-sports.io', timezone = 'Europe/Istanbul', dataRoot, request = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date(), maxRetries = 2 } = {}) {
    super('api-football');
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timezone = timezone;
    this.dataRoot = dataRoot;
    this.request = request;
    this.sleep = sleep;
    this.now = now;
    this.maxRetries = maxRetries;
    this.quota = { provider: this.name, remaining: null, limit: null };
    this.validationErrors = [];
    this.seasons = null;
  }

  async isConfigured() { return Boolean(this.apiKey); }
  async isAvailable() { return this.isConfigured(); }
  seasonCacheFile() { return this.dataRoot ? path.join(this.dataRoot, 'api-football-seasons.json') : null; }
  readSeasonCache() {
    if (this.seasons) return this.seasons;
    try {
      const value = JSON.parse(fs.readFileSync(this.seasonCacheFile(), 'utf8'));
      if (Date.now() - new Date(value.updatedAt).getTime() < SEASON_CACHE_MS) return (this.seasons = value.seasons);
    } catch {}
    return null;
  }
  writeSeasonCache(seasons) {
    this.seasons = seasons;
    const file = this.seasonCacheFile();
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ updatedAt: this.now().toISOString(), seasons }, null, 2));
  }
  captureQuota(headers) {
    const remaining = headers?.get?.('x-ratelimit-requests-remaining') ?? headers?.get?.('x-ratelimit-remaining');
    const limit = headers?.get?.('x-ratelimit-requests-limit') ?? headers?.get?.('x-ratelimit-limit');
    this.quota = { provider: this.name, remaining: remaining == null ? null : Number(remaining), limit: limit == null ? null : Number(limit) };
  }
  async call(endpoint) {
    if (!this.apiKey) throw new FixtureProviderError('API-Football anahtarı tanımlanmamış', { code: 'NOT_CONFIGURED' });
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response;
      try { response = await this.request(`${this.baseUrl}${endpoint}`, { headers: { 'x-apisports-key': this.apiKey, Accept: 'application/json' } }); }
      catch (error) {
        if (attempt === this.maxRetries) throw new FixtureProviderError('API-Football bağlantısı kurulamadı', { code: 'NETWORK_ERROR', retryable: true });
        await this.sleep(250 * (attempt + 1)); continue;
      }
      this.captureQuota(response.headers);
      if (response.status === 401 || response.status === 403) throw new FixtureProviderError(`API-Football kimlik doğrulama hatası (${response.status})`, { code: 'AUTH_ERROR', status: response.status });
      if (response.status === 429) {
        if (attempt === this.maxRetries) throw new FixtureProviderError('API-Football günlük veya anlık kota sınırına ulaştı', { code: 'RATE_LIMIT', status: 429 });
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (attempt + 1)); continue;
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt < this.maxRetries) { await this.sleep(250 * (attempt + 1)); continue; }
        throw new FixtureProviderError(`API-Football HTTP ${response.status} döndürdü`, { code: 'HTTP_ERROR', status: response.status });
      }
      let payload;
      try { payload = await response.json(); } catch { throw new FixtureProviderError('API-Football bozuk JSON döndürdü', { code: 'INVALID_JSON' }); }
      if (payload?.errors && (Array.isArray(payload.errors) ? payload.errors.length : Object.keys(payload.errors).length)) throw new FixtureProviderError('API-Football hata cevabı döndürdü', { code: 'API_ERROR' });
      return payload;
    }
  }
  async fetchSeasonMap() {
    const cached = this.readSeasonCache();
    if (cached) return cached;
    if (!this.seasonPromise) this.seasonPromise = (async () => {
      const payload = await this.call('/leagues?current=true');
      const seasons = {};
      for (const row of payload?.response || []) {
        const current = row.seasons?.find(item => item.current === true);
        if (row.league?.id && Number.isInteger(current?.year)) seasons[row.league.id] = current.year;
      }
      this.writeSeasonCache(seasons);
      return seasons;
    })().finally(() => { this.seasonPromise = null; });
    return this.seasonPromise;
  }
  async fetchCurrentSeason(league) {
    try { return (await this.fetchSeasonMap())[league.id] ?? fallbackSeason(this.now()); }
    catch { return fallbackSeason(this.now()); }
  }
  normalizeFixture(row, league, season, fetchedAt) {
    const fixture = row?.fixture, teams = row?.teams, goals = row?.goals;
    if (!fixture?.id || !fixture?.date || !teams?.home?.name || !teams?.away?.name) throw new Error('Tarih veya takım bilgisi eksik');
    const date = new Date(fixture.date);
    if (!Number.isFinite(date.getTime())) throw new Error('Maç tarihi geçersiz');
    const short = fixture.status?.short || 'TBD';
    return {
      id: `api-football-${fixture.id}`, provider: this.name, providerMatchId: fixture.id,
      leagueId: league.id, leagueName: league.name, country: league.country,
      season: row.league?.season ?? season, round: row.league?.round ?? null,
      home: teams.home.name, away: teams.away.name, homeLogo: teams.home.logo || '', awayLogo: teams.away.logo || '',
      date: fixture.date, kickoffUtc: date.toISOString(), kickoffLocal: localDateTime(date, this.timezone),
      timezone: fixture.timezone || this.timezone, timestamp: fixture.timestamp ?? Math.floor(date.getTime() / 1000),
      status: short, statusCategory: statusCategory(short), statusLong: fixture.status?.long || null,
      venue: fixture.venue?.name || null, city: fixture.venue?.city || null, referee: fixture.referee || null,
      homeScore: goals?.home ?? null, awayScore: goals?.away ?? null,
      source: 'API-Football', sourceUrl: null, fetchedAt, demo: false
    };
  }
  async fetchFixtures({ league, from, to, timezone = this.timezone }) {
    this.validationErrors = [];
    const season = await this.fetchCurrentSeason(league);
    const query = new URLSearchParams({ league: String(league.id), season: String(season), from, to, timezone });
    const payload = await this.call(`/fixtures?${query}`);
    if (!Array.isArray(payload?.response)) throw new FixtureProviderError('API-Football beklenen fikstür listesini döndürmedi', { code: 'INVALID_SCHEMA' });
    const fetchedAt = this.now().toISOString();
    return payload.response.flatMap(row => {
      try {
        const match = this.normalizeFixture(row, league, season, fetchedAt);
        const day = dateKeyInZone(match.kickoffUtc, timezone);
        return day >= from && day <= to ? [match] : [];
      } catch (error) { this.validationErrors.push(`Kayıt ${row?.fixture?.id || 'kimliksiz'}: ${error.message}`); return []; }
    });
  }
  async healthCheck() {
    if (!(await this.isConfigured())) return { ok: false, error: 'API anahtarı tanımlanmamış' };
    await this.call('/status');
    return { ok: true, quota: this.quota };
  }
}

module.exports = { ApiFootballProvider, fallbackSeason, statusCategory, SEASON_CACHE_MS };
