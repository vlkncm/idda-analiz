const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, seasonLabel } = require('../international-provider');

test('Avrupa futbol sezonu etiketi doğru oluşturulur', () => {
  assert.equal(seasonLabel(new Date('2026-08-22T00:00:00Z')), '2026-2027');
  assert.equal(seasonLabel(new Date('2027-02-01T00:00:00Z')), '2026-2027');
});

test('TheSportsDB karşılaşması uygulama biçimine dönüştürülür', () => {
  const match = normalizeEvent({ idEvent: '2494005', strTimestamp: '2026-08-22T16:30:00', strHomeTeam: 'Brentford', strAwayTeam: 'Tottenham Hotspur', strStatus: 'NS', strVenue: 'Community Stadium' }, { id: 39 });
  assert.equal(match.id, 'free-tsdb-2494005');
  assert.equal(match.leagueId, 39);
  assert.equal(match.source, 'TheSportsDB');
  assert.equal(match.date, '2026-08-22T16:30:00Z');
});
