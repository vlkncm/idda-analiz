const test = require('node:test');
const assert = require('node:assert/strict');
const { leagues } = require('../server');

test('Süper Lig ve beş büyük lig tanımlıdır', () => {
  assert.deepEqual(leagues.map(x => x.id), [203, 39, 140, 78, 135, 61]);
});
