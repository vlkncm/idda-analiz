'use strict';

class FixtureProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', status = null, retryable = false } = {}) {
    super(message);
    this.name = 'FixtureProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class FixtureProvider {
  constructor(name) { this.name = name; }
  async isConfigured() { return true; }
  async isAvailable() { return true; }
  async healthCheck() { return { ok: await this.isConfigured() }; }
  async fetchCurrentSeason() { return null; }
  async fetchLeagues() { return []; }
  async fetchFixtures() { throw new Error('fetchFixtures uygulanmalı'); }
  normalizeLeague(league) { return league; }
  normalizeFixture(fixture) { return fixture; }
}

module.exports = { FixtureProvider, FixtureProviderError };
