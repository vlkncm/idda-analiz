'use strict';

const crypto = require('node:crypto');
const { FixtureProvider, FixtureProviderError } = require('./base');
const { LEAGUES, normalizeFixture, dateKeyInZone } = require('./model');
const { fetchText } = require('./http');

const DIVISIONS = { 203: 'T1', 39: 'E0', 140: 'SP1', 78: 'D1', 135: 'I1', 61: 'F1' };
const ZONES = { T1: 'Europe/Istanbul', E0: 'Europe/London', SP1: 'Europe/Madrid', D1: 'Europe/Berlin', I1: 'Europe/Rome', F1: 'Europe/Paris' };

function parseCsvLine(line) {
  const cells = []; let value = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(value); value = ''; }
    else value += char;
  }
  cells.push(value); return cells;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length || /^\s*</.test(lines[0])) throw new FixtureProviderError('Football-Data.co.uk bozuk CSV veya HTML döndürdü', { code: 'INVALID_CSV' });
  const headers = parseCsvLine(lines.shift()).map(value => value.trim());
  for (const required of ['Div', 'Date', 'HomeTeam', 'AwayTeam']) if (!headers.includes(required)) throw new FixtureProviderError(`Football-Data.co.uk CSV alanı eksik: ${required}`, { code: 'INVALID_CSV' });
  return lines.map(line => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });
}

function zonedLocalToUtc(dateValue, timeValue, timeZone) {
  const parts = String(dateValue).trim().split(/[/-]/).map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) throw new Error('Maç tarihi geçersiz');
  let [day, month, year] = parts;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const [hour = 12, minute = 0] = String(timeValue || '12:00').split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    const formatted = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = type => Number(formatted.find(part => part.type === type)?.value);
    const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    guess += target - shown;
  }
  return new Date(guess).toISOString();
}

class FootballDataUkFixtureProvider extends FixtureProvider {
  constructor({ url = 'https://www.football-data.co.uk/matches/resources/fixtures.csv', timeoutMs = 12000, request = fetchText } = {}) {
    super('football-data.co.uk'); this.url = url; this.timeoutMs = timeoutMs; this.request = request; this.cache = null; this.loadPromise = null; this.retryAfter = 0;
  }
  async isAvailable(league) { return Boolean(DIVISIONS[league?.id]); }
  async rows() {
    if (this.cache) return this.cache;
    if (Date.now() < this.retryAfter) throw new FixtureProviderError('Football-Data.co.uk geçici olarak kullanılamıyor', { code: 'SOURCE_COOLDOWN', retryable: true });
    if (!this.loadPromise) this.loadPromise = this.request(this.url, { timeoutMs: this.timeoutMs, maxBytes: 3_000_000, allowedDomains: ['football-data.co.uk'] }).then(parseCsv);
    try { this.cache = await this.loadPromise; }
    catch (error) { this.retryAfter = Date.now() + 30_000; throw error; }
    finally { this.loadPromise = null; }
    return this.cache;
  }
  async fetchFixtures({ league, from, to }) {
    if (!(await this.isAvailable(league))) return [];
    this.validationErrors = [];
    const division = DIVISIONS[league.id], fetchedAt = new Date().toISOString();
    return (await this.rows()).filter(row => row.Div === division).flatMap(row => {
      try {
        const kickoffUtc = zonedLocalToUtc(row.Date, row.Time, ZONES[division]);
        const identity = crypto.createHash('sha256').update(`${division}|${row.Date}|${row.Time}|${row.HomeTeam}|${row.AwayTeam}`).digest('hex').slice(0, 24);
        const match = normalizeFixture({ providerMatchId: identity, home: row.HomeTeam, away: row.AwayTeam, kickoffUtc, status: 'SCHEDULED', source: 'Football-Data.co.uk', sourceUrl: this.url }, { provider: this.name, league, fetchedAt });
        const key = dateKeyInZone(match.kickoffUtc);
        return key >= from && key <= to ? [match] : [];
      } catch (error) { this.validationErrors.push(`Kayıt ${row.HomeTeam || 'kimliksiz'}: ${error.message}`); return []; }
    });
  }
}

module.exports = { DIVISIONS, parseCsvLine, parseCsv, zonedLocalToUtc, FootballDataUkFixtureProvider };
