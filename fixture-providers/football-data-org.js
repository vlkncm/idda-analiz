'use strict';

const { FixtureProvider, FixtureProviderError } = require('./base');
const { normalizeFixture } = require('./model');
const { fetchJson } = require('./http');

class FootballDataOrgProvider extends FixtureProvider {
  constructor({ apiKey, baseUrl = 'https://api.football-data.org/v4', timeoutMs = 12000, request = fetchJson } = {}) {
    super('football-data.org');
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.request = request;
  }
  async isAvailable(league) { return Boolean(this.apiKey && league?.footballDataCode); }
  async isConfigured() { return Boolean(this.apiKey); }
  async healthCheck() {
    if (!this.apiKey) return { ok: false, error: 'API anahtarı tanımlanmamış' };
    const payload = await this.request(`${this.baseUrl}/competitions`, { headers: { 'X-Auth-Token': this.apiKey }, timeoutMs: this.timeoutMs, allowedDomains: ['api.football-data.org'] });
    return { ok: Array.isArray(payload?.competitions) };
  }
  async fetchFixtures({ league, from, to }) {
    if (!(await this.isAvailable(league))) return [];
    this.validationErrors = [];
    const url = `${this.baseUrl}/competitions/${encodeURIComponent(league.footballDataCode)}/matches?dateFrom=${from}&dateTo=${to}`;
    const payload = await this.request(url, { headers: { 'X-Auth-Token': this.apiKey }, timeoutMs: this.timeoutMs, allowedDomains: ['api.football-data.org'] });
    if (!Array.isArray(payload.matches)) throw new FixtureProviderError('football-data.org beklenen maç listesini döndürmedi', { code: 'INVALID_SCHEMA' });
    const fetchedAt = new Date().toISOString();
    return payload.matches.flatMap(row => {
      try {
        return [normalizeFixture({
          providerMatchId: row.id, season: row.season?.startDate ? `${row.season.startDate.slice(0, 4)}-${row.season.endDate?.slice(0, 4) || Number(row.season.startDate.slice(0, 4)) + 1}` : null,
          round: row.matchday || row.stage, home: row.homeTeam?.name, away: row.awayTeam?.name,
          homeLogo: row.homeTeam?.crest, awayLogo: row.awayTeam?.crest, kickoffUtc: row.utcDate,
          status: row.status, venue: row.venue, referee: row.referees?.[0]?.name,
          homeScore: row.score?.fullTime?.home, awayScore: row.score?.fullTime?.away,
          source: 'football-data.org', sourceUrl: `https://www.football-data.org/competition/${league.footballDataCode}`
        }, { provider: this.name, league, fetchedAt })];
      } catch (error) { this.validationErrors.push(`Kayıt ${row?.id || 'kimliksiz'}: ${error.message}`); return []; }
    });
  }
}

module.exports = { FootballDataOrgProvider };
