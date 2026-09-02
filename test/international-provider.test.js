const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, normalizeEspnEvent, seasonLabel, footballDataSeasonCode, parseCsvLine, parseFootballDataCsv } = require('../international-provider');

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

test('Football-Data sezon kodu doğru oluşturulur', () => {
  assert.equal(footballDataSeasonCode(2026), '2627');
  assert.equal(footballDataSeasonCode(1999), '9900');
});

test('tırnak ve virgül içeren CSV satırı doğru ayrıştırılır', () => {
  assert.deepEqual(parseCsvLine('E0,"Team, City",Other,2'), ['E0', 'Team, City', 'Other', '2']);
});

test('Football-Data geçmiş maçları ortak analiz biçimine dönüştürülür', () => {
  const csv = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG\nE0,22/08/2026,Arsenal,Chelsea,2,1,1,0\nE0,29/08/2026,Liverpool,Everton,,,,\n';
  const rows = parseFootballDataCsv(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { home:'Arsenal', away:'Chelsea', home_score:2, away_score:1, home_ht:1, away_ht:0, date:'22/08/2026', status:'finished', source:'Football-Data.co.uk' });
});

test('ESPN karşılaşması uygulama biçimine dönüştürülür', () => {
  const event={id:'401',date:'2026-09-04T19:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Ipswich Town',logo:'home.png'}},{homeAway:'away',team:{displayName:'Liverpool',logo:'away.png'}}],venue:{fullName:'Portman Road'}}]};
  const match=normalizeEspnEvent(event,{id:39,name:'Premier League'});
  assert.equal(match.id,'free-espn-401');
  assert.equal(match.leagueId,39);
  assert.equal(match.home,'Ipswich Town');
  assert.equal(match.away,'Liverpool');
  assert.equal(match.source,'ESPN');
});
