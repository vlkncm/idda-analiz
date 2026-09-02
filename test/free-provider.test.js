const test = require('node:test');
const assert = require('node:assert/strict');
const { key, historyStats } = require('../free-provider');

test('Erzurumspor ve sponsorlu Konyaspor adları geçmiş veriyle eşleşir', () => {
  assert.equal(key('Erzurumspor FK'), key('Erzurum BB'));
  assert.equal(key('TÜMOSAN Konyaspor'), key('Konyaspor'));
  const rows = [
    { home:'Erzurum BB', away:'Konyaspor', home_score:1, away_score:2, home_ht:1, away_ht:1 },
    { home:'Konyaspor', away:'Galatasaray', home_score:1, away_score:1, home_ht:0, away_ht:1 }
  ];
  assert.equal(historyStats(rows,'Erzurumspor FK','home').played,1);
  assert.equal(historyStats(rows,'TÜMOSAN Konyaspor','away').played,1);
});
