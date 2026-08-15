const https = require('node:https');

const TRANSFERMARKT_ABSENCES = 'https://www.transfermarkt.com/super-lig/sperrenausfaelle/wettbewerb/TR1/page/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36 IDDA-Analiz/1.0';
const pageCache=new Map();

function decode(value='') { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;|&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function teamKey(value='') { return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/\b(a\.?s\.?|fk|sk|corendon|arca|futbol kulubu)\b/g,'').replace(/[^a-z0-9]/g,''); }
function sameTeam(a,b) { const x=teamKey(a),y=teamKey(b); return x&&y&&(x.includes(y)||y.includes(x)); }

function getLegacy(url) { return new Promise((resolve,reject)=>https.get(url,{rejectUnauthorized:false,headers:{'User-Agent':UA}},r=>{if(r.statusCode!==200)return reject(new Error(`TFF ${r.statusCode}`));const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve(new TextDecoder('windows-1254').decode(Buffer.concat(chunks))));}).on('error',reject)); }
async function getModern(url) { const hit=pageCache.get(url);if(hit&&Date.now()-hit.time<30*60000)return hit.value;const value=await fetch(url,{headers:{'user-agent':UA,'accept-language':'tr-TR,tr;q=0.9,en;q=0.7'}}).then(async r=>{if(!r.ok)throw new Error(`Kaynak ${r.status}`);return r.text()});pageCache.set(url,{time:Date.now(),value});return value; }

function parseTff(html) {
  const referee=decode(html.match(/>([^<>]+)\(Hakem\)<\/a>/i)?.[1]||'');
  const lineup={home:[],away:[],homeBench:[],awayBench:[],confirmed:false};
  const playerRx=/grdTakim([12])_(rptKadrolar|rptYedekler)[\s\S]{0,450}?formaNo[^>]*>([^<]*)<\/span>[\s\S]{0,300}?lnkOyuncu[^>]*>([^<]+)<\/a>/gi;
  for(const m of html.matchAll(playerRx)){const side=m[1]==='1'?'home':'away',bench=m[2]==='rptYedekler';lineup[bench?`${side}Bench`:side].push({number:decode(m[3]).replace('.',''),name:decode(m[4])});}
  lineup.confirmed=lineup.home.length>=11&&lineup.away.length>=11;
  return{referee,lineup};
}

function parseAbsences(html,homeName,awayName) {
  const result={home:[],away:[]};
  for(const body of html.split(/<tr class="(?:odd|even)">/i).slice(1)){
    const player=body.match(/class=hauptlink><a title="([^"]+)"[^>]+\/profil\/spieler/i)?.[1],team=body.match(/<a title="([^"]+)" href="\/[^"]+\/startseite\/verein\//i)?.[1];
    if(!player||!team)continue;
    const cells=[...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>decode(x[1]));
    const reason=cells.find(x=>/injur|surgery|fitness|suspend|eligib|ill|tear|fracture|strain|problem|knock|red card|yellow card/i.test(x))||'Kadro dışı / oynama uygunluğu yok';
    const item={name:decode(player),type:/suspend|card|eligib/i.test(reason)?'Cezalı/uygun değil':'Sakat',reason,source:'Transfermarkt'};
    if(sameTeam(team,homeName))result.home.push(item);else if(sameTeam(team,awayName))result.away.push(item);
  }
  return result;
}

async function enrichMatch(match) {
  const sources=[],errors=[];let tff={referee:'',lineup:{home:[],away:[],homeBench:[],awayBench:[],confirmed:false}},injuries={home:[],away:[]};
  const matchId=String(match.id||'').match(/(\d+)$/)?.[1];
  const tasks=[];
  if(matchId)tasks.push(getLegacy(`https://www.tff.org/Default.aspx?pageId=29&macId=${matchId}`).then(html=>{tff=parseTff(html);sources.push({name:'TFF',fields:['Hakem','Kesin kadro','Yedekler'],url:`https://www.tff.org/Default.aspx?pageId=29&macId=${matchId}`});}).catch(e=>errors.push(`TFF: ${e.message}`)));
  tasks.push(getModern(TRANSFERMARKT_ABSENCES).then(html=>{injuries=parseAbsences(html,match.home,match.away);sources.push({name:'Transfermarkt',fields:['Sakat/cezalı'],url:TRANSFERMARKT_ABSENCES});}).catch(e=>errors.push(`Transfermarkt: ${e.message}`)));
  await Promise.all(tasks);
  return{...tff,injuries,sources,errors,updatedAt:new Date().toISOString()};
}

module.exports={enrichMatch,parseTff,parseAbsences,teamKey,sameTeam};
