const test = require('node:test');
const assert = require('node:assert/strict');
const { seasonFor, leagues } = require('../server');

test('Avrupa futbol sezonunu doğru hesaplar', () => {
  assert.equal(seasonFor(new Date('2026-08-15')), 2026);
  assert.equal(seasonFor(new Date('2027-02-15')), 2026);
});

test('Süper Lig ve beş büyük lig tanımlıdır', () => {
  assert.deepEqual(leagues.map(x => x.id), [203, 39, 140, 78, 135, 61]);
});
