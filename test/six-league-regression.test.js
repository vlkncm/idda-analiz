'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LEAGUES, sameTeam } = require('../fixture-providers/model');
const { FixtureProviderManager } = require('../fixture-providers/manager');
const { internationalAnalysis } = require('../international-analysis-provider');
const { freeAnalysis } = require('../free-provider');
const { analyzeMatch, analyzeCouponMatches } = require('../server');

const teams = {
  203: ['Fenerbahçe SK','Galatasaray SK','Fenerbahce','Galatasaray'],
  39: ['Manchester United FC','Tottenham Hotspur FC','Manchester United','Tottenham'],
  140: ['Atlético Madrid','Athletic Club','Atletico Madrid','Athletic Bilbao'],
  78: ['FC Bayern München','Borussia Mönchengladbach','Bayern Munich','Borussia Monchengladbach'],
  135: ['Internazionale','AC Milan','Inter','AC Milan'],
  61: ['Paris Saint-Germain','Olympique de Marseille','PSG','Marseille']
};
function fixture(league) { const [home,away]=teams[league.id]; return { id:`api-football-${league.id}`,provider:'api-football',providerMatchId:league.id,leagueId:league.id,leagueName:league.name,home,away,kickoffUtc:'2026-09-05T18:00:00Z',status:'NS',statusCategory:'SCHEDULED',demo:false }; }
function historyRows(leagueId) {
  const [, , home, away] = teams[leagueId];
  return [
    {leagueId,home,away:'Rakip A',home_score:2,away_score:0,home_ht:1,away_ht:0,playedAt:'2026-08-01T12:00:00Z',source:'mock'},
    {leagueId,home,away:'Rakip B',home_score:1,away_score:1,home_ht:1,away_ht:0,playedAt:'2026-08-08T12:00:00Z',source:'mock'},
    {leagueId,home:'Rakip C',away,home_score:0,away_score:2,home_ht:0,away_ht:1,playedAt:'2026-08-15T12:00:00Z',source:'mock'},
    {leagueId,home:'Rakip D',away,home_score:1,away_score:1,home_ht:1,away_ht:0,playedAt:'2026-08-22T12:00:00Z',source:'mock'},
    {leagueId,home,away,home_score:2,away_score:1,home_ht:1,away_ht:0,playedAt:'2026-08-29T12:00:00Z',source:'mock'}
  ];
}
function readyAnalysis(match) { return { analysisReady:true,matchedTeams:{home:match.home,away:match.away},home:{played:3},away:{played:3},h2h:{played:1},scores:{homeAdvantage:55,over25:50,btts:50,confidence:70},recommendation:{primary:{market:'1X',confidence:70,reason:'Mock'}},limitations:[] }; }

test('altı ligin her biri provider yöneticisinden gerçek modelde fikstür döndürür', async () => {
  const primary={name:'api-football',isAvailable:async()=>true,fetchFixtures:async({league})=>[fixture(league)]};
  const result=await new FixtureProviderManager({providers:[primary],leagues:LEAGUES,logger:{error(){}}}).fetchFixtures({from:'2026-09-01',to:'2026-09-15'});
  assert.equal(result.matches.length,6);
  for(const league of LEAGUES)assert.equal(result.matches.filter(match=>match.leagueId===league.id).length,1,league.name);
});
test('altı lig için geçmiş veri doğru leagueId ile analiz sağlayıcısına aktarılır', async () => {
  for(const league of LEAGUES){const match=fixture(league);let received=null;const fetchHistory=async leagueId=>{received=leagueId;return historyRows(leagueId);};const analysis=league.id===203?await freeAnalysis(match,{fetchHistory}):await internationalAnalysis(match,{fetchHistory});assert.equal(received,league.id);assert.equal(analysis.analysisReady,true,league.name);assert.ok(analysis.home.played>=2);assert.ok(analysis.away.played>=2);assert.notEqual(analysis.decision,'PAS GEÇ');assert.ok(analysis.primarySelection);}
});
test('her ligden gerçekçi takım aliasları kesin eşleşir, genel kelimeler eşleşmez', () => {
  const pairs=[['Fenerbahçe SK','Fenerbahce'],['Galatasaray SK','Galatasaray'],['Manchester United FC','Manchester United'],['Tottenham Hotspur FC','Tottenham'],['Atlético Madrid','Atletico Madrid'],['Athletic Club','Athletic Bilbao'],['FC Bayern München','Bayern Munich'],['Bayern Münih','Bayern Munich'],['Internazionale','Inter'],['Inter Milan','Inter'],['Paris Saint-Germain','PSG'],['Olympique de Marseille','Marseille']];
  for(const [left,right] of pairs)assert.equal(sameTeam(left,right),true,`${left} -> ${right}`);
  assert.equal(sameTeam('Manchester United','Newcastle United'),false); assert.equal(sameTeam('Manchester City','Leicester City'),false); assert.equal(sameTeam('Sporting CP','Sporting Gijon'),false);
});
test('maç kimliği veya provider yerine leagueId analiz yönlendirmesini belirler', async () => {
  let turkey=0,europe=0;const deps={turkeyAnalysis:async match=>{turkey++;return readyAnalysis(match);},europeanAnalysis:async match=>{europe++;return readyAnalysis(match);},enrichmentProvider:async()=>({injuries:{home:[],away:[]},lineup:null,referee:null,sources:[],errors:[]})};
  await analyzeMatch(fixture(LEAGUES[0]),deps); await analyzeMatch(fixture(LEAGUES[1]),deps);
  assert.equal(turkey,1);assert.equal(europe,1);
});
test('gerçek maç için yetersiz geçmişte demo analiz üretilmez', async () => {
  const match=fixture(LEAGUES[1]);
  await assert.rejects(()=>analyzeMatch(match,{europeanAnalysis:async()=>({analysisReady:false,matchedTeams:{},home:{played:0},away:{played:0}})}),/yeterli geçmiş/i);
});
test('bir lig bozulduğunda diğer beş ligin fikstürü korunur', async () => {
  const provider={name:'api-football',isAvailable:async()=>true,fetchFixtures:async({league})=>{if(league.id===140)throw new Error('mock failure');return[fixture(league)];}};
  const result=await new FixtureProviderManager({providers:[provider],leagues:LEAGUES,logger:{error(){}}}).fetchFixtures({from:'2026-09-01',to:'2026-09-15'});
  assert.equal(result.matches.length,5);assert.equal(result.matches.some(match=>match.leagueId===140),false);
});
test('kupon değerlendirme girdisine altı ligin tamamı katılır', async () => {
  const matches=LEAGUES.map(fixture),seen=[];
  const rows=await analyzeCouponMatches('all',{service:{list:async()=>({matches})},analyze:async id=>{seen.push(id);return readyAnalysis(matches.find(match=>match.id===id));}});
  assert.equal(rows.length,6);assert.equal(new Set(rows.map(row=>row.match.leagueId)).size,6);assert.equal(seen.length,6);
});
test('kaynak yönetimi ve teknik provider tablosu arayüzden kaldırılmıştır', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  for(const forbidden of ['KAYNAK YÖNETİMİ','Siteyi İncele','Alan eşleştirmeleri','VERİ KAYNAKLARI','Bağlantıyı Test Et',"Cache'i Görüntüle",'providerHealth','sourceAdmin'])assert.doesNotMatch(`${html}\n${js}`,new RegExp(forbidden,'i'));
  assert.match(html,/Maçları Güncelle/);assert.match(html,/Tek Tuşla Kupon/);
});
test('masaüstü iki kolon ve mobil tek kolon görünümü korunur', () => {
  const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');
  assert.match(css,/\.match-grid\{display:grid;grid-template-columns:repeat\(2,1fr\)/);assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/\.match-grid,.summary,.analysis-cols,.analysis-scores\{grid-template-columns:1fr\}/);
});
