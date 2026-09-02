const test = require('node:test');
const assert = require('node:assert/strict');
const { teamStats } = require('../international-analysis-provider');

test('yabancı lig geçmişinden takım formu hesaplanır', () => {
  const rows=[
    {home:'Arsenal',away:'Chelsea',home_score:2,away_score:1,home_ht:1,away_ht:0},
    {home:'Arsenal',away:'Liverpool',home_score:1,away_score:1,home_ht:0,away_ht:1}
  ];
  const stats=teamStats(rows,'Arsenal','home');
  assert.equal(stats.played,2);
  assert.equal(stats.wins,1);
  assert.equal(stats.draws,1);
  assert.equal(stats.btts,100);
});

test('farklı kaynaklardaki takım adları aynı takımla eşleşir', () => {
  const rows=[
    {home:'FC Koln',away:'Bayern Munchen',home_score:1,away_score:2,home_ht:0,away_ht:1},
    {home:'Nottm Forest',away:'Wolves',home_score:1,away_score:1,home_ht:1,away_ht:0}
  ];
  assert.equal(teamStats(rows,'FC Cologne','home').played,1);
  assert.equal(teamStats(rows,'Bayern Munich','away').played,1);
  assert.equal(teamStats(rows,'Nottingham Forest','home').played,1);
  assert.equal(teamStats(rows,'Wolverhampton Wanderers','away').played,1);
});
