'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LEAGUES, dateKeyInZone, addCalendarDays, filterFixtures } = require('./fixture-providers/model');
const { FixtureProviderManager } = require('./fixture-providers/manager');
const { TffFixtureProvider } = require('./fixture-providers/tff');
const { FootballDataOrgProvider } = require('./fixture-providers/football-data-org');
const { FootballDataUkFixtureProvider } = require('./fixture-providers/football-data-uk');
const { TheSportsDbProvider } = require('./fixture-providers/the-sports-db');
const { ApiFootballProvider } = require('./fixture-providers/api-football');
const { EspnFixtureProvider } = require('./fixture-providers/espn');

const CACHE_SCHEMA_VERSION = 2;

function numberSetting(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function fixtureSettings(env = process.env) {
  return {
    provider: String(env.FIXTURE_PROVIDER || 'auto').trim().toLowerCase(),
    apiFootballKey: String(env.API_FOOTBALL_KEY || '').trim(),
    apiFootballBaseUrl: String(env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io').trim(),
    timezone: String(env.FIXTURE_TIMEZONE || 'Europe/Istanbul').trim(),
    lookaheadDays: numberSetting(env.FIXTURE_LOOKAHEAD_DAYS, 14, 1, 31),
    cacheMinutes: numberSetting(env.FIXTURE_CACHE_MINUTES ?? env.CACHE_MINUTES, 360, 1, 1440),
    refreshCooldownSeconds: numberSetting(env.FIXTURE_REFRESH_COOLDOWN_SECONDS, 60, 60, 300),
    footballDataApiKey: String(env.FOOTBALL_DATA_API_KEY || '').trim(),
    footballDataBaseUrl: String(env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4').trim(),
    sportsDbApiKey: String(env.THESPORTSDB_API_KEY || '123').trim()
  };
}

function createProviders(settings) {
  const providers = [
    new EspnFixtureProvider(),
    new ApiFootballProvider({ apiKey: settings.apiFootballKey, baseUrl: settings.apiFootballBaseUrl, timezone: settings.timezone, dataRoot: settings.dataRoot }),
    new TffFixtureProvider(),
    new FootballDataOrgProvider({ apiKey: settings.footballDataApiKey, baseUrl: settings.footballDataBaseUrl }),
    new FootballDataUkFixtureProvider(),
    new TheSportsDbProvider({ apiKey: settings.sportsDbApiKey })
  ];
  if (settings.provider === 'auto' || settings.provider === 'espn') return providers;
  const aliases = { espn: 'espn', 'api-football': 'api-football', tff: 'tff', 'football-data': 'football-data.org', 'football-data.org': 'football-data.org', 'football-data.co.uk': 'football-data.co.uk', thesportsdb: 'thesportsdb' };
  const selected = aliases[settings.provider];
  return selected ? [...providers.filter(provider => provider.name === selected), ...providers.filter(provider => provider.name !== selected)] : providers;
}

class FixtureService {
  constructor({ dataRoot, settings = fixtureSettings(), manager, now = () => new Date(), logger = console } = {}) {
    this.dataRoot = dataRoot || path.join(__dirname, 'data');
    this.cacheFile = path.join(this.dataRoot, 'fixtures-cache.json');
    this.settings = { ...settings, dataRoot: this.dataRoot };
    this.manager = manager || new FixtureProviderManager({ providers: createProviders(this.settings), leagues: LEAGUES, logger, now });
    this.now = now;
    this.lastForcedRefresh = 0;
    this.inFlight = null;
  }

  readCache() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (payload?.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(payload.matches) || !payload.dateRange || !payload.leagues) return null;
      const leagueIds = new Set(payload.matches.map(match => Number(match.leagueId)));
      if ([...leagueIds].some(id => !payload.leagues[String(id)])) return null;
      return payload;
    } catch { return null; }
  }

  writeCache(payload) {
    fs.mkdirSync(this.dataRoot, { recursive: true });
    const temporary = `${this.cacheFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporary, this.cacheFile);
  }

  isFresh(cache) {
    const updated = new Date(cache?.updatedAt).getTime();
    if (!Number.isFinite(updated) || this.now().getTime() - updated >= this.settings.cacheMinutes * 60_000) return false;
    const today = dateKeyInZone(this.now(), this.settings.timezone);
    if (cache.dateRange.from !== today || cache.dateRange.to !== addCalendarDays(today, this.settings.lookaheadDays)) return false;
    return cache.matches.some(match => dateKeyInZone(match.kickoffUtc, this.settings.timezone) >= today);
  }

  async getAll({ forceRefresh = false } = {}) {
    const cache = this.readCache();
    const now = this.now();
    if (forceRefresh && now.getTime() - this.lastForcedRefresh < this.settings.refreshCooldownSeconds * 1000) {
      if (cache) return { ...cache, fromCache: true, warnings: [...cache.warnings, 'Yenileme isteği çok kısa aralıkla tekrarlandı; mevcut önbellek korundu.'] };
    }
    if (!forceRefresh && cache && this.isFresh(cache)) return { ...cache, fromCache: true, isStale: Boolean(cache.isStale) };
    if (forceRefresh) this.lastForcedRefresh = now.getTime();
    const from = dateKeyInZone(now);
    const to = addCalendarDays(from, this.settings.lookaheadDays);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh({ cache, now, from, to });
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }

  async refresh({ cache, now, from, to }) {
    const result = await this.manager.fetchFixtures({ from, to, timezone: this.settings.timezone, cachedMatches: cache?.matches || [] });
    const publicWarnings = [...result.warnings];
    if (!result.matches.length && cache?.matches?.length) {
      return { ...cache, fromCache: true, isStale: true, warnings: publicWarnings, errors: result.errors };
    }
    const payload = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      matches: result.matches,
      updatedAt: now.toISOString(),
      providers: result.providers,
      warnings: publicWarnings,
      errors: result.errors,
      isStale: Boolean(result.isStale),
      fromCache: false,
      dateRange: { from, to },
      leagues: Object.fromEntries(LEAGUES.map(league => [String(league.id), { provider: result.providers.find(row => Number(row.leagueId) === league.id)?.name || null, season: result.matches.find(match => Number(match.leagueId) === league.id)?.season || null, count: result.matches.filter(match => Number(match.leagueId) === league.id).length }])),
      quota: this.manager.getQuota?.() || { provider: 'api-football', remaining: null, limit: null },
      health: result.health || this.manager.getHealth?.() || [],
      range: { from, to, days: this.settings.lookaheadDays }
    };
    this.writeCache(payload);
    return payload;
  }

  async list({ forceRefresh = false, league = 'all', range = '14' } = {}) {
    const payload = await this.getAll({ forceRefresh });
    return { ...payload, matches: filterFixtures(payload.matches, { league, range, now: this.now() }), selected: { league, range } };
  }
}

module.exports = { CACHE_SCHEMA_VERSION, fixtureSettings, createProviders, FixtureService };
