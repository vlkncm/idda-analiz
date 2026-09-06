'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvLine } = require('../fixture-providers/football-data-uk');
const { EspnFixtureProvider } = require('../fixture-providers/espn');
const { FOOTBALL_DATA_UK_LEAGUES, seasonLabel, seasonStart, footballDataSeasonCode, footballDataHistoryUrl, csvHistoryRows, parseOpenFootball, fetchLeagueHistory, clearHistoryCache } = require('../international-provider');

test('Avrupa futbol sezonu etiketi temmuz geçişiyle doğru oluşturulur', () => {
  assert.equal(seasonLabel(new Date('2026-08-22T00:00:00Z')), '2026-2027');
  assert.equal(seasonLabel(new Date('2027-02-01T00:00:00Z')), '2026-2027');
  assert.equal(seasonStart(new Date('2027-07-01T00:00:00Z')), 2027);
});
test('altı lig Football-Data.co.uk kodu ve geçmiş sezon URL biçimi doğrudur', () => {
  assert.deepEqual(FOOTBALL_DATA_UK_LEAGUES, { 39:'E0',140:'SP1',78:'D1',135:'I1',61:'F1',203:'T1' });
  assert.equal(footballDataSeasonCode(2025), '2526');
  assert.equal(footballDataHistoryUrl(39, 2025), 'https://www.football-data.co.uk/mmz4281/2526/E0.csv');
  assert.equal(footballDataHistoryUrl(140, 2025), 'https://www.football-data.co.uk/mmz4281/2526/SP1.csv');
});
test('geçmiş CSV satırları lig kimliğini kaybetmeden normalize edilir', () => {
  const csv='Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG\nE0,30/08/2026,Manchester United,Arsenal,2,1,1,0';
  assert.deepEqual(csvHistoryRows(csv,39)[0],{leagueId:39,home:'Manchester United',away:'Arsenal',home_score:2,away_score:1,home_ht:1,away_ht:0,homeXg:null,awayXg:null,homeShots:null,awayShots:null,homeShotsOnTarget:null,awayShotsOnTarget:null,homeRedCards:null,awayRedCards:null,competitionType:'league',playedAt:'2026-08-30T12:00:00.000Z',status:'finished',source:'Football-Data.co.uk'});
});
test('ISO tarihli Football-Data arşivi ve tarihli OpenFootball sonuçları ayrıştırılır', () => {
  assert.equal(csvHistoryRows('Date,HomeTeam,AwayTeam,FTHG,FTAG\n2025-08-30,A,B,2,1',39)[0].playedAt,'2025-08-30T12:00:00.000Z');
  const rows=parseOpenFootball('= Turkish Süper Lig 2025/26\n  Fri Aug 8 2025\n    20:30  Gaziantep FK            v Galatasaray              0-3 (0-3)\n  Sat Jan 10\n           Galatasaray             v Konyaspor                2-0');
  assert.equal(rows.length,2);assert.equal(rows[0].playedAt,'2025-08-08T12:00:00.000Z');assert.equal(rows[1].playedAt,'2026-01-10T12:00:00.000Z');
});
test('geçmiş cache anahtarı lig bazındadır ve yanlış lig verisi paylaşılmaz', async () => {
  clearHistoryCache(); const calls=[];
  const request=async url=>{calls.push(url);const div=url.endsWith('/E0.csv')?'E0':'SP1';return{ok:true,status:200,text:async()=>`Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG\n${div},30/08/2026,Home ${div},Away ${div},2,1,1,0`};};
  const england=await fetchLeagueHistory(39,new Date('2026-09-01T12:00:00Z'),{request});
  const spain=await fetchLeagueHistory(140,new Date('2026-09-01T12:00:00Z'),{request});
  assert.ok(england.every(row=>row.leagueId===39)); assert.ok(spain.every(row=>row.leagueId===140));
  assert.notEqual(england[0].home,spain[0].home); assert.equal(calls.length,16);
});
test('geçmiş sonuçlar hesaplamadan önce kronolojik sıralanır', async () => {
  clearHistoryCache();
  const request=async url=>{const div=url.endsWith('/E0.csv')?'E0':'X';return{ok:true,status:200,text:async()=>div==='E0'?'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,30/08/2026,A,B,1,0\nE0,01/08/2026,C,D,0,0':'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG'};};
  const rows=await fetchLeagueHistory(39,new Date('2026-09-01T12:00:00Z'),{request});
  assert.equal(rows[0].playedAt,'2026-08-01T12:00:00.000Z');assert.equal(rows.at(-1).playedAt,'2026-08-30T12:00:00.000Z');
});

test('Football-Data sezon kodu doğru oluşturulur', () => {
  assert.equal(footballDataSeasonCode(2026), '2627');
  assert.equal(footballDataSeasonCode(1999), '9900');
});

test('tırnak ve virgül içeren CSV satırı doğru ayrıştırılır', () => {
  assert.deepEqual(parseCsvLine('E0,"Team, City",Other,2'), ['E0', 'Team, City', 'Other', '2']);
});

test('Football-Data geçmiş maçları ortak analiz biçimine dönüştürülür', () => {
  const csv = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG\nE0,22/08/2026,Arsenal,Chelsea,2,1,1,0\nE0,29/08/2026,Liverpool,Everton,,,,\n';
  const rows = csvHistoryRows(csv, 39);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].home, 'Arsenal'); assert.equal(rows[0].away, 'Chelsea');
  assert.equal(rows[0].home_score, 2); assert.equal(rows[0].away_score, 1);
  assert.equal(rows[0].playedAt, '2026-08-22T12:00:00.000Z');
});

test('ESPN karşılaşması uygulama biçimine dönüştürülür', async () => {
  const event={id:'401',date:'2026-09-04T19:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Ipswich Town',logo:'home.png'}},{homeAway:'away',team:{displayName:'Liverpool',logo:'away.png'}}],venue:{fullName:'Portman Road'}}]};
  const provider = new EspnFixtureProvider({ now: () => new Date('2026-09-01'), request: async () => ({ events: [event] }) });
  const [match] = await provider.fetchFixtures({league:{id:39,name:'Premier League',espnSlug:'eng.1'},from:'2026-09-01',to:'2026-09-10'});
  assert.equal(match.id,'espn:401');
  assert.equal(match.leagueId,39);
  assert.equal(match.home,'Ipswich Town');
  assert.equal(match.away,'Liverpool');
  assert.equal(match.source,'ESPN');
});
