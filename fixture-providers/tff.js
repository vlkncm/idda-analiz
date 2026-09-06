'use strict';

const { FixtureProvider } = require('./base');
const { LEAGUES, normalizeFixture, dateKeyInZone } = require('./model');
const { fetchTffMatches } = require('../free-provider');

class TffFixtureProvider extends FixtureProvider {
  constructor({ fetchMatches = fetchTffMatches } = {}) { super('tff'); this.fetchMatches = fetchMatches; }
  async isAvailable(league) { return Number(league?.id) === 203; }
  async healthCheck() { const rows = await this.fetchMatches(); return { ok: Array.isArray(rows), count: rows?.length || 0 }; }
  async fetchLeagues() { return [LEAGUES.find(league => league.id === 203)]; }
  async fetchFixtures({ league, from, to }) {
    if (!(await this.isAvailable(league))) return [];
    this.validationErrors = [];
    const fetchedAt = new Date().toISOString();
    const rows = await this.fetchMatches();
    return rows.flatMap(row => {
      try {
        const match = normalizeFixture({
          providerMatchId: String(row.id).replace(/^free-tff-/, ''), home: row.home, away: row.away,
          kickoffUtc: row.date, status: row.status, venue: row.venue, referee: row.referee,
          homeScore: row.homeScore, awayScore: row.awayScore, source: 'TFF', sourceUrl: row.sourceUrl
        }, { provider: this.name, league, fetchedAt });
        const key = dateKeyInZone(match.kickoffUtc);
        return key >= from && key <= to ? [match] : [];
      } catch (error) { this.validationErrors.push(`Kayıt ${row?.id || 'kimliksiz'}: ${error.message}`); return []; }
    });
  }
}

module.exports = { TffFixtureProvider };
