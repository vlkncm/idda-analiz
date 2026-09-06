'use strict';

const { FixtureProvider } = require('./base');
const { fetchJson } = require('./http');
const { normalizeFixture, dateKeyInZone } = require('./model');

function compactDate(value) { return String(value || '').replace(/-/g, ''); }

class EspnFixtureProvider extends FixtureProvider {
  constructor({ baseUrl = 'https://site.api.espn.com/apis/site/v2/sports/soccer', timeoutMs = 12000, request = fetchJson, now = () => new Date() } = {}) {
    super('espn');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.request = request;
    this.now = now;
  }

  async isAvailable(league) { return Boolean(league?.espnSlug); }

  async healthCheck() { return { ok: true, message: 'Lig bazında istek sırasında doğrulanır.' }; }

  async fetchFixtures({ league, from, to, timezone = 'Europe/Istanbul' }) {
    if (!(await this.isAvailable(league))) return [];
    this.validationErrors = [];
    const url = `${this.baseUrl}/${encodeURIComponent(league.espnSlug)}/scoreboard?dates=${compactDate(from)}-${compactDate(to)}&limit=1000`;
    const payload = await this.request(url, { timeoutMs: this.timeoutMs, allowedDomains: ['espn.com'] });
    const fetchedAt = this.now().toISOString();
    return (Array.isArray(payload?.events) ? payload.events : []).flatMap(event => {
      try {
        const competition = event?.competitions?.[0];
        const home = competition?.competitors?.find(item => item.homeAway === 'home');
        const away = competition?.competitors?.find(item => item.homeAway === 'away');
        const completed = Boolean(event?.status?.type?.completed);
        const state = String(event?.status?.type?.state || '').toLowerCase();
        const kickoff = new Date(event?.date);
        if (completed || state === 'post' || !Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= this.now().getTime()) return [];
        const match = normalizeFixture({
          providerMatchId: event.id,
          season: null,
          round: event.week?.number || competition?.week?.number,
          home: home?.team?.displayName || home?.team?.name,
          away: away?.team?.displayName || away?.team?.name,
          homeLogo: home?.team?.logo || '', awayLogo: away?.team?.logo || '',
          kickoffUtc: event.date, status: event.status?.type?.name || state,
          venue: competition?.venue?.fullName,
          referee: competition?.officials?.[0]?.displayName,
          source: 'ESPN', sourceUrl: event.links?.[0]?.href || ''
        }, { provider: this.name, league, fetchedAt });
        const day = dateKeyInZone(match.kickoffUtc, timezone);
        return day >= from && day <= to && match.status === 'SCHEDULED' ? [match] : [];
      } catch (error) {
        this.validationErrors.push(`Kayıt ${event?.id || 'kimliksiz'}: ${error.message}`);
        return [];
      }
    });
  }
}

module.exports = { EspnFixtureProvider, compactDate };
