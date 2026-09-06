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
test('son 10 hesabı girdi sırasından bağımsız olarak en yeni maçları kullanır', () => {
  const rows=Array.from({length:12},(_,index)=>({home:'Arsenal',away:`Team ${index}`,home_score:index<2?0:2,away_score:index<2?1:0,playedAt:new Date(Date.UTC(2026,0,index+1)).toISOString()})).reverse();
  const stats=teamStats(rows,'Arsenal','home');
  assert.equal(stats.played,10);assert.equal(stats.wins,10);assert.equal(stats.form,'WWWWWWWWWW');
});
