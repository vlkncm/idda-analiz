const { predictMatchResult } = require('./analyzer');
const { fetchLeagueHistory } = require('./international-provider');
const aliases=new Map(Object.entries({
  fccologne:'fckoln',
  koln:'fckoln',
  borussiamonchengladbach:'borussiamgladbach',
  mgladbach:'borussiamgladbach',
  bayernmunich:'bayernmunchen',
  interMilan:'internazionale',
  intermilano:'internazionale',
  nottinghamforest:'nottmforest',
  wolverhamptonwanderers:'wolves',
  athleticclub:'athleticbilbao',
  athbilbao:'athleticbilbao',
  atleticodeMadrid:'atleticomadrid',
  athmadrid:'atleticomadrid',
  parissaintgermain:'parissg'
}).map(([name,value])=>[name.toLowerCase(),value]));
function key(name=''){const normalized=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');return aliases.get(normalized)||normalized}
function same(a,b){const x=key(a),y=key(b);return x&&y&&(x.includes(y)||y.includes(x))}
function teamStats(rows,name,venue){const selected=rows.filter(row=>(same(row.home,name)||same(row.away,name))&&(venue==='home'?same(row.home,name):same(row.away,name))).slice(-10);let wins=0,draws=0,losses=0,gf=0,ga=0,over=0,btts=0,first=0;for(const row of selected){const home=same(row.home,name),a=home?row.home_score:row.away_score,b=home?row.away_score:row.home_score,half=home?row.home_ht:row.away_ht;gf+=a;ga+=b;first+=half;a>b?wins++:a<b?losses++:draws++;if(a+b>2)over++;if(a>0&&b>0)btts++}const n=selected.length||1;return{played:selected.length,wins,draws,losses,goalsForAvg:+(gf/n).toFixed(2),goalsAgainstAvg:+(ga/n).toFixed(2),firstHalfAvg:+(first/n).toFixed(2),secondHalfAvg:+((gf-first)/n).toFixed(2),over25:Math.round(over/n*100),btts:Math.round(btts/n*100),form:selected.map(row=>{const home=same(row.home,name),a=home?row.home_score:row.away_score,b=home?row.away_score:row.home_score;return a>b?'W':a<b?'L':'D'}).join('')}}
async function internationalAnalysis(match){const rows=await fetchLeagueHistory(match.leagueId),home=teamStats(rows,match.home,'home'),away=teamStats(rows,match.away,'away'),shared=rows.filter(row=>(same(row.home,match.home)&&same(row.away,match.away))||(same(row.home,match.away)&&same(row.away,match.home))).slice(-10);let homeWins=0,awayWins=0,draws=0;for(const row of shared){if(row.home_score===row.away_score)draws++;else{const winner=row.home_score>row.away_score?row.home:row.away;same(winner,match.home)?homeWins++:awayWins++}}const goals=shared.map(row=>row.home_score+row.away_score),h2h={played:shared.length,homeWins,draws,awayWins,goalsAvg:goals.length?+(goals.reduce((a,b)=>a+b,0)/goals.length).toFixed(2):0,over25:goals.length?Math.round(goals.filter(x=>x>2).length/goals.length*100):0},homeAdvantage=Math.max(25,Math.min(75,Math.round(52+(home.wins-away.wins)*4+(home.goalsForAvg-away.goalsForAvg)*6))),over25=Math.round((home.over25+away.over25+(h2h.played?h2h.over25:(home.over25+away.over25)/2))/3),scores={homeAdvantage,over25,btts:Math.round((home.btts+away.btts)/2),firstHalf:Math.round(Math.min(100,(home.firstHalfAvg+away.firstHalfAvg)/3*100)),secondHalf:Math.round(Math.min(100,(home.secondHalfAvg+away.secondHalfAvg)/3.4*100)),confidence:home.played>=2&&away.played>=2?72:home.played&&away.played?62:45};return{free:true,home,away,h2h,injuries:{home:[],away:[]},players:{home:[],away:[]},referee:{home:{referee:'Veri bulunamadı',matches:0,wins:0,draws:0,losses:0},away:{referee:'Veri bulunamadı',matches:0,wins:0,draws:0,losses:0}},scores,predictedResult:predictMatchResult({scores,home,away,h2h}),verdict:`${homeAdvantage>=58?'Ev sahibi':homeAdvantage<=42?'Deplasman':'Dengeli maç'}; 2,5 üst eğilimi %${over25}.`,generatedAt:new Date().toISOString(),limitations:['Ücretsiz TheSportsDB geçmiş verisiyle hesaplandı.']}}
module.exports={internationalAnalysis,teamStats};
