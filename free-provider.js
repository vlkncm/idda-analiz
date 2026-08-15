const https = require('node:https');
const TFF_URL = 'https://www.tff.org/Default.aspx?pageId=198';

function getTff() {
  return new Promise((resolve, reject) => {
    https.get(TFF_URL, { rejectUnauthorized: false, headers: { 'User-Agent': 'IDDA-Analiz/1.0' } }, response => {
      if (response.statusCode !== 200) return reject(new Error(`TFF ${response.statusCode}`));
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new TextDecoder('windows-1254').decode(Buffer.concat(chunks))));
    }).on('error', reject);
  });
}
function clean(value) { return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function slug(name) { return name.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-a-s$/, '').replace(/^arca-/, '').replace(/^corendon-/, ''); }

async function fetchTffMatches() {
  const html = await getTff();
  const rows = [...html.matchAll(/<tr class="haftaninMaclariTr">([\s\S]*?)<\/tr>/gi)];
  return rows.flatMap(([, row]) => {
    const date = row.match(/lblTarih[^>]*>([^<]+)/i)?.[1];
    const time = row.match(/lblSaat[^>]*>([^<]+)/i)?.[1] || '12:00';
    const home = clean(row.match(/haftaninMaclariEv[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const away = clean(row.match(/haftaninMaclariDeplasman[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const matchId = row.match(/macId=(\d+)/i)?.[1];
    if (!date || !home || !away) return [];
    const [day, month, year] = date.split('.');
    return [{ id: `free-tff-${matchId || `${year}${month}${day}-${home}`}`, leagueId: 203, home, away, date: `${year}-${month}-${day}T${time}:00+03:00`, status: 'NS', venue: 'TFF maç merkezi', referee: 'Maç detayında açıklanır', homeScore: null, over25: null, btts: null, confidence: null, reasons: ['TFF resmî haftalık fikstürü', 'Ayrıntılı analiz takım geçmişinden hesaplanır'], demo: false, source: 'TFF', homeSlug: slug(home), awaySlug: slug(away), sourceUrl: matchId ? `https://www.tff.org/Default.aspx?pageId=29&macId=${matchId}` : TFF_URL }];
  });
}
async function sportTeam(teamSlug) { const response = await fetch(`https://sportscore.com/api/widget/team/?sport=football&slug=${encodeURIComponent(teamSlug)}&limit=30&src=idda-analiz`); if (!response.ok) return []; return (await response.json()).matches || []; }
function stats(rows, name) { const done = rows.filter(x => x.status === 'finished' && x.home_score != null); let w=0,d=0,l=0,gf=0,ga=0,over=0,btts=0; for (const x of done) { const isHome=x.home.toLowerCase().includes(name.toLowerCase().split(' ')[0]), a=Number(isHome?x.home_score:x.away_score), b=Number(isHome?x.away_score:x.home_score); gf+=a;ga+=b;a>b?w++:a<b?l++:d++;if(a+b>2)over++;if(a&&b)btts++; } const n=done.length||1; return { played:done.length,wins:w,draws:d,losses:l,goalsForAvg:+(gf/n).toFixed(2),goalsAgainstAvg:+(ga/n).toFixed(2),firstHalfAvg:0,secondHalfAvg:0,over25:Math.round(over/n*100),btts:Math.round(btts/n*100),form:'' }; }
async function history() { const urls=['2025-26_tr1.txt','2024-25_tr1.txt'].map(x=>`https://raw.githubusercontent.com/openfootball/europe/master/turkey/${x}`); const texts=await Promise.all(urls.map(async u=>{const r=await fetch(u);return r.ok?r.text():''})); return texts.flatMap(parseHistory); }
function parseHistory(text) { return [...text.matchAll(/^\s*(?:\d{1,2}:\d{2}\s+)?(.+?)\s{2,}v\s+(.+?)\s{2,}(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?\s*$/gm)].map(m=>({home:m[1].trim(),away:m[2].trim(),home_score:m[3],away_score:m[4],home_ht:m[5],away_ht:m[6],status:'finished'})); }
function key(name) { return slug(name).replace(/-(fk|sk|jk)$/, '').replace(/istanbul-/, '').replace(/arca-|corendon-/, ''); }
function hasTeam(row,name) { const k=key(name),h=key(row.home),a=key(row.away); return h.includes(k)||k.includes(h)||a.includes(k)||k.includes(a); }
function historyStats(rows,name,venue) { const k=key(name),selected=rows.filter(x=>hasTeam(x,name)&&(venue==='home'?key(x.home).includes(k)||k.includes(key(x.home)):venue==='away'?key(x.away).includes(k)||k.includes(key(x.away)):true)).slice(-10); let w=0,d=0,l=0,gf=0,ga=0,fh=0,sh=0,over=0,btts=0; for(const x of selected){const isHome=key(x.home).includes(k)||k.includes(key(x.home)),a=Number(isHome?x.home_score:x.away_score),b=Number(isHome?x.away_score:x.home_score),half=Number(isHome?x.home_ht:x.away_ht)||0;gf+=a;ga+=b;fh+=half;sh+=Math.max(0,a-half);a>b?w++:a<b?l++:d++;if(a+b>2)over++;if(a&&b)btts++;}const n=selected.length||1;return{played:selected.length,wins:w,draws:d,losses:l,goalsForAvg:+(gf/n).toFixed(2),goalsAgainstAvg:+(ga/n).toFixed(2),firstHalfAvg:+(fh/n).toFixed(2),secondHalfAvg:+(sh/n).toFixed(2),over25:Math.round(over/n*100),btts:Math.round(btts/n*100),form:selected.map(x=>{const isHome=key(x.home).includes(k)||k.includes(key(x.home)),a=Number(isHome?x.home_score:x.away_score),b=Number(isHome?x.away_score:x.home_score);return a>b?'W':a<b?'L':'D'}).join('')}}
async function freeAnalysis(match) { const rows=await history(),home=historyStats(rows,match.home,'home'),away=historyStats(rows,match.away,'away'),hk=key(match.home),ak=key(match.away);const shared=rows.filter(x=>hasTeam(x,match.home)&&hasTeam(x,match.away)).slice(-10),goals=shared.map(x=>Number(x.home_score)+Number(x.away_score));let hw=0,aw=0,draws=0;for(const x of shared){const a=Number(x.home_score),b=Number(x.away_score);if(a===b)draws++;else{const winner=key(a>b?x.home:x.away);winner.includes(hk)||hk.includes(winner)?hw++:aw++;}}const h2h={played:shared.length,homeWins:hw,draws,awayWins:aw,goalsAvg:goals.length?+(goals.reduce((a,b)=>a+b,0)/goals.length).toFixed(2):0,over25:goals.length?Math.round(goals.filter(x=>x>2).length/goals.length*100):0};const over25=Math.round((home.over25+away.over25+h2h.over25)/3),homeAdvantage=Math.max(25,Math.min(75,50+(home.wins-away.wins)*4+(home.goalsForAvg-away.goalsForAvg)*5)),firstHalf=Math.round(Math.min(100,(home.firstHalfAvg+away.firstHalfAvg)/2/1.5*100)),secondHalf=Math.round(Math.min(100,(home.secondHalfAvg+away.secondHalfAvg)/2/1.7*100));return{free:true,home,away,h2h,injuries:{home:[],away:[]},players:{home:[],away:[]},referee:{home:{referee:'Veri bulunamadı',matches:0,wins:0,draws:0,losses:0},away:{referee:'Veri bulunamadı',matches:0,wins:0,draws:0,losses:0}},scores:{homeAdvantage:Math.round(homeAdvantage),over25,btts:Math.round((home.btts+away.btts)/2),firstHalf,secondHalf,confidence:home.played&&away.played?70:45},verdict:verdict(homeAdvantage,over25),generatedAt:new Date().toISOString(),limitations:['Sakat/cezalı ve hakem verisi ücretsiz geçmiş sonuç kaynağında bulunmuyor.']};}
function verdict(homeAdvantage,over25){const side=homeAdvantage>=60?'Ev sahibi daha avantajlı':homeAdvantage<=40?'Deplasman takımı daha avantajlı':'Maç dengeli görünüyor';const goals=over25>=60?'Gol eğilimi yüksek':over25<=40?'Gol eğilimi düşük':'Gol eğilimi orta seviyede';return `${side}. ${goals}.`;}

module.exports = { fetchTffMatches, freeAnalysis };
