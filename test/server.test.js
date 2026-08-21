const test = require('node:test');
const assert = require('node:assert/strict');
const { seasonFor, leagues, shouldUseApiFootball } = require('../server');

test('Avrupa futbol sezonunu doğru hesaplar', () => {
  assert.equal(seasonFor(new Date('2026-08-15')), 2026);
  assert.equal(seasonFor(new Date('2027-02-15')), 2026);
});

test('Süper Lig ve beş büyük lig tanımlıdır', () => {
  assert.deepEqual(leagues.map(x => x.id), [203, 39, 140, 78, 135, 61]);
});

test('API anahtarı girildiğinde yabancı lig sağlayıcısı otomatik etkinleşir', () => {
  assert.equal(shouldUseApiFootball('gecerli-anahtar', undefined), true);
  assert.equal(shouldUseApiFootball('', undefined), false);
  assert.equal(shouldUseApiFootball('gecerli-anahtar', 'false'), false);
});
