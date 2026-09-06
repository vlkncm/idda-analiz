'use strict';

const { FixtureProvider, FixtureProviderError } = require('./base');
const { normalizeFixture, dateKeyInZone, seasonForDate } = require('./model');
const { fetchJson } = require('./http');

class TheSportsDbProvider extends FixtureProvider {
  constructor({ apiKey = '123', baseUrl = 'https://www.thesportsdb.com/api/v1/json', timeoutMs = 12000, request = fetchJson } = {}) {
    super('thesportsdb');
    this.apiKey = String(apiKey || '123').trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.request = request;
  }
  async isAvailable(league) { return Boolean(league?.sportsDbId); }
  async healthCheck() {
    const payload = await this.request(`${this.baseUrl}/${encodeURIComponent(this.apiKey)}/all_leagues.php`, { timeoutMs: this.timeoutMs, allowedDomains: ['thesportsdb.com'] });
    return { ok: Array.isArray(payload?.leagues) };
  }
  async fetchFixtures({ league, from, to }) {
    if (!(await this.isAvailable(league))) return [];
    this.validationErrors = [];
    const season = seasonForDate(`${from}T12:00:00Z`, league);
    const currentStart = Number(season.slice(0, 4));
    const primaryEndpoints = [`eventsseason.php?id=${league.sportsDbId}&s=${season}`, `eventsnextleague.php?id=${league.sportsDbId}`];
    let settled = await Promise.allSettled(primaryEndpoints.map(endpoint => this.request(`${this.baseUrl}/${encodeURIComponent(this.apiKey)}/${endpoint}`, { timeoutMs: this.timeoutMs, allowedDomains: ['thesportsdb.com'] })));
    let events = settled.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value?.events) ? result.value.events : []);
    if (!events.length) {
      const adjacent = [`${currentStart - 1}-${currentStart}`, `${currentStart + 1}-${currentStart + 2}`];
      const adjacentResults = await Promise.allSettled(adjacent.map(value => this.request(`${this.baseUrl}/${encodeURIComponent(this.apiKey)}/eventsseason.php?id=${league.sportsDbId}&s=${value}`, { timeoutMs: this.timeoutMs, allowedDomains: ['thesportsdb.com'] })));
      settled = [...settled, ...adjacentResults];
      events = adjacentResults.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value?.events) ? result.value.events : []);
    }
    if (!events.length && settled.every(result => result.status === 'rejected')) throw settled[0].reason;
    const fetchedAt = new Date().toISOString();
    const seen = new Set();
    return events.flatMap(row => {
      if (!row?.idEvent || seen.has(String(row.idEvent))) return [];
      seen.add(String(row.idEvent));
      try {
        const timestamp = row.strTimestamp || (row.dateEvent ? `${row.dateEvent}T${row.strTime || '12:00:00'}Z` : null);
        const match = normalizeFixture({
          providerMatchId: row.idEvent, season: row.strSeason || season, round: row.intRound,
          home: row.strHomeTeam, away: row.strAwayTeam, homeLogo: row.strHomeTeamBadge, awayLogo: row.strAwayTeamBadge,
          kickoffUtc: timestamp, status: row.strStatus, venue: row.strVenue, referee: row.strOfficial,
          homeScore: row.intHomeScore, awayScore: row.intAwayScore,
          source: 'TheSportsDB', sourceUrl: `https://www.thesportsdb.com/event/${row.idEvent}`
        }, { provider: this.name, league, fetchedAt });
        const key = dateKeyInZone(match.kickoffUtc);
        return key >= from && key <= to ? [match] : [];
      } catch (error) { this.validationErrors.push(`Kayıt ${row?.idEvent || 'kimliksiz'}: ${error.message}`); return []; }
    });
  }
}

module.exports = { TheSportsDbProvider };
