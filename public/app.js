'use strict';

const state = { leagues: [], ranges: [], matches: [], leagueCounts: {}, selectedLeague: 'all', selectedRange: '14', loading: false };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const dateFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
const trDate = value => dateFmt.format(new Date(value));
const trTime = value => timeFmt.format(new Date(value));
const trDateTime = value => `${trDate(value)} ${trTime(value)}`;
async function getJson(url) { const response = await fetch(url); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'İstek tamamlanamadı'); return payload; }

async function init() {
  try {
    const config = await getJson('/api/config');
    state.leagues = config.leagues || []; state.ranges = config.dateRanges || [];
    renderControls(); await loadMatches();
  } catch (error) { showFatal(error.message); }
}
async function loadMatches(refresh = false) {
  if (state.loading) return;
  state.loading = true; $('#refresh').disabled = true; $('#refresh').textContent = 'Maçlar güncelleniyor…';
  $('#sourceStatus').textContent = 'Maçlar güncelleniyor…'; $('#matches').innerHTML = '<div class="loading">Maçlar güncelleniyor…</div>';
  try {
    const query = new URLSearchParams({ league: state.selectedLeague, range: state.selectedRange }); if (refresh) query.set('refresh', '1');
    const data = await getJson(`/api/matches?${query}`); state.matches = Array.isArray(data.matches) ? data.matches : []; state.leagueCounts = data.leagues || state.leagueCounts;
    renderPayload(data, refresh);
  } catch (error) { showFatal(error.message); }
  finally { state.loading = false; $('#refresh').disabled = false; $('#refresh').textContent = '↻ Maçları Güncelle'; }
}
function renderControls() {
  const all = [{ id: 'all', name: 'Tüm ligler', flag: '◉' }, ...state.leagues];
  const total = Object.values(state.leagueCounts).reduce((sum, item) => sum + Number(item?.count || 0), 0);
  $('#leagueFilters').innerHTML = all.map(item => { const count = item.id === 'all' ? total : Number(state.leagueCounts[String(item.id)]?.count || 0); return `<button class="filter ${String(item.id) === state.selectedLeague ? 'active' : ''}" data-league="${esc(item.id)}">${esc(item.flag)} ${esc(item.name)} <b>${count}</b></button>`; }).join('');
  $('#dateFilters').innerHTML = state.ranges.map(item => `<button class="filter ${item.id === state.selectedRange ? 'active' : ''}" data-range="${esc(item.id)}">${esc(item.name)}</button>`).join('');
  document.querySelectorAll('[data-league]').forEach(button => button.onclick = () => changeFilter('selectedLeague', button.dataset.league));
  document.querySelectorAll('[data-range]').forEach(button => button.onclick = () => changeFilter('selectedRange', button.dataset.range));
}
async function changeFilter(key, value) { state[key] = value; renderControls(); await loadMatches(); }
function renderPayload(data, refreshed) {
  renderControls();
  const range = state.ranges.find(item => item.id === state.selectedRange)?.name || 'Seçili tarih';
  const league = state.selectedLeague === 'all' ? 'Tüm ligler' : state.leagues.find(item => String(item.id) === state.selectedLeague)?.name || 'Seçili lig';
  $('#matchCount').textContent = state.matches.length; $('#rangeCaption').textContent = range; $('#selectedRange').textContent = range; $('#leagueSummary').textContent = league;
  $('#dataState').textContent = data.isStale ? 'Son başarılı veriler' : 'Güncel'; $('#sourceStatus').textContent = 'Maçlar güncellendi.';
  $('#statusDot').classList.toggle('warning-dot', Boolean(data.warnings?.length)); $('#updatedAt').textContent = data.updatedAt ? `Son güncelleme: ${trDateTime(data.updatedAt)}` : '';
  const messages = [];
  if (refreshed) messages.push('Maçlar güncellendi.');
  if (data.warnings?.length) messages.push(...data.warnings);
  if (data.errors?.length) messages.push(...data.errors.map(item => `${item.leagueName || 'Lig'} / ${item.provider || 'kaynak'}: ${item.message || item.code}`));
  if (!state.matches.length) messages.push('Bu lig için yaklaşan maç bulunamadı.');
  showNotice(messages); renderMatches();
}
function renderMatches() {
  if (!state.matches.length) return void ($('#matches').innerHTML = '<div class="empty"><strong>Bu lig için yaklaşan maç bulunamadı.</strong></div>');
  $('#matches').innerHTML = state.matches.map(match => `<article class="match"><div class="match-head"><span class="league">${esc(match.leagueName)}</span><span>${trDate(match.kickoffUtc)} · ${trTime(match.kickoffUtc)}</span></div><div class="teams"><div class="team">${logo(match.homeLogo)}${esc(match.home)}</div><div class="versus">VS</div><div class="team">${logo(match.awayLogo)}${esc(match.away)}</div></div><div class="fixture-meta"><span>Tarih<b>${trDate(match.kickoffUtc)}</b></span><span>Türkiye saati<b>${trTime(match.kickoffUtc)}</b></span><span>Durum<b>${esc(statusLabel(match.status))}</b></span></div><button class="analyze-button" data-analysis-id="${esc(match.id)}">Analiz Et</button></article>`).join('');
  document.querySelectorAll('[data-analysis-id]').forEach(button => button.onclick = () => showDetail(button.dataset.analysisId));
}
function logo(src) { return src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''; }
function statusLabel(status) { return ({ NS:'Başlamadı',TBD:'Zaman belli değil','1H':'Canlı',HT:'Canlı','2H':'Canlı',ET:'Canlı',BT:'Canlı',P:'Canlı',LIVE:'Canlı',FT:'Tamamlandı',AET:'Tamamlandı',PEN:'Tamamlandı',PST:'Ertelendi',CANC:'İptal edildi',ABD:'Yarıda kaldı',AWD:'Hükmen sonuçlandı',WO:'Hükmen sonuçlandı',SCHEDULED:'Başlamadı',FINISHED:'Tamamlandı',POSTPONED:'Ertelendi',SUSPENDED:'Yarıda kaldı',CANCELLED:'İptal edildi' })[status] || status || 'Bilinmiyor'; }
function showNotice(rows) { const clean=[...new Set(rows.filter(Boolean))]; $('#notice').classList.toggle('show',clean.length>0); $('#notice').innerHTML=clean.map(value=>`<div>${esc(value)}</div>`).join(''); }
function showFatal(message) { $('#sourceStatus').textContent='Maçlar alınamadı.'; $('#dataState').textContent='Hata'; showNotice([message]); $('#matches').innerHTML='<div class="empty"><strong>Bazı liglerin maçları şu anda alınamadı.</strong></div>'; }
function valueOrDash(value, suffix='') { return value == null || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`; }
async function showDetail(id) {
  const match=state.matches.find(item=>String(item.id)===String(id)); if(!match)return;
  $('#dialogContent').innerHTML=`<p class="eyebrow">${esc(match.leagueName)}</p><h2>${esc(match.home)} – ${esc(match.away)}</h2><div class="loading">Olasılık motoru çalışıyor…</div>`; $('#detailDialog').showModal();
  try {
    const analysis=await getJson(`/api/analysis?id=${encodeURIComponent(id)}`),p=analysis.probabilities||{},h2h=analysis.h2h;
    $('#dialogContent').innerHTML=`<p class="eyebrow">${esc(match.leagueName)} · ${esc(analysis.engine||'olasılık motoru')}</p><h2>${esc(match.home)} – ${esc(match.away)}</h2><p class="detail-meta">${trDateTime(match.kickoffUtc)} · ${analysis.calibrated?'Kalibre edilmiş olasılıklar':'Standart Poisson/Elo'}</p><div class="analysis-scores">${score('Ev sahibi',p.home)}${score('Beraberlik',p.draw)}${score('Deplasman',p.away)}${score('Veri güveni',analysis.dataQualityScore)}</div><section class="decision ${analysis.decision==='VERİ YETERSİZ'?'decision-pass':''}"><span>MODEL KARARI</span><h3>${esc(analysis.decision||'VERİ YETERSİZ')}</h3><p>Beklenen gol: ${valueOrDash(analysis.expectedGoals?.home)} – ${valueOrDash(analysis.expectedGoals?.away)} · En olası skor: ${esc(analysis.topScores?.[0]?.score||'—')}</p><p>Model keskinliği: ${valueOrDash(analysis.modelConfidence,'%')} · Veri güveni: ${valueOrDash(analysis.dataQualityScore,'%')}</p></section>${selectionPanel(analysis)}${marketGrid(p)}${topScores(analysis.topScores)}<div class="analysis-cols"><section class="analysis-panel">${formTable(`${match.home} · evinde`,analysis.home)}</section><section class="analysis-panel">${formTable(`${match.away} · deplasmanda`,analysis.away)}</section></div>${standingsTable(analysis.standings)}${absenceTable(analysis.absences)}${h2h?h2hTable(h2h):''}${modelTable(analysis.modelDetails)}<p class="decision-warnings">${esc(analysis.warning||'Kesin sonuç veya kazanç garantisi yoktur.')}${[...(analysis.limitations||[]),...(analysis.missingDataWarnings||[])].length?' · '+[...(analysis.limitations||[]),...(analysis.missingDataWarnings||[])].map(esc).join(' · '):''}</p>`;
  } catch (error) { $('#dialogContent').innerHTML=`<p class="eyebrow">ANALİZ</p><h2>${esc(match.home)} – ${esc(match.away)}</h2><p>Analiz için yeterli geçmiş veri bulunamadı.</p>`; }
}
function score(label,value){return `<div class="score-box"><strong>${valueOrDash(value,value==null?'':'%')}</strong><span>${esc(label)}</span></div>`;}
function rate(value){return value==null?null:Number(value)<=1?(Number(value)*100).toFixed(1):Number(value).toFixed(1);}
function formTable(name,data={}){return `<h3>${esc(name)}</h3><table><tr><td>Örnek (son 5 / son 10)</td><td>${valueOrDash(data.windows?.last5?.played)} / ${valueOrDash(data.windows?.last10?.played||data.played)}</td></tr><tr><td>Maç / G-B-M</td><td>${valueOrDash(data.played)} / ${valueOrDash(data.wins)}-${valueOrDash(data.draws)}-${valueOrDash(data.losses)}</td></tr><tr><td>Puan/maç</td><td>${valueOrDash(data.pointsPerMatch)}</td></tr><tr><td>Attığı / yediği gol</td><td>${valueOrDash(data.goalsForAvg)} / ${valueOrDash(data.goalsAgainstAvg)}</td></tr><tr><td>2,5 Üst / KG Var</td><td>${valueOrDash(rate(data.over25),'%')} / ${valueOrDash(rate(data.btts),'%')}</td></tr><tr><td>Form</td><td>${esc(data.form||'—')}</td></tr></table>`;}
function marketGrid(p){const rows=[['1X',p.oneX],['X2',p.xTwo],['12',p.twelve],['1,5 Alt',p.under15],['1,5 Üst',p.over15],['2,5 Alt',p.under25],['2,5 Üst',p.over25],['3,5 Alt',p.under35],['3,5 Üst',p.over35],['KG Var',p.bttsYes],['KG Yok',p.bttsNo],['Ev 0,5 gol',p.homeOver05],['Dep. 0,5 gol',p.awayOver05],['İY 0,5 gol',p.firstHalfOver05],['2Y 0,5 gol',p.secondHalfOver05]];return `<section class="analysis-panel market-panel"><h3>Pazar olasılıkları</h3><div class="market-grid">${rows.map(([label,value])=>`<span>${esc(label)}<b>${valueOrDash(value,value==null?'':'%')}</b></span>`).join('')}</div></section>`;}
function selectionPanel(analysis){const primary=analysis.primarySelection;if(!primary)return `<section class="analysis-panel"><h3>Seçim üretilemedi</h3><p>${esc((analysis.decisionReasons||[]).join(' · '))}</p></section>`;const alternatives=analysis.alternativeSelections||[];return `<section class="analysis-panel"><h3>En güçlü seçim: ${esc(primary.market)} · %${esc(primary.probability)}</h3><p>Risk: ${esc(primary.risk)} · Veri güveni: %${esc(primary.dataConfidence)} · Kullanılan maç: ${esc(primary.usedMatches?.total)}</p><p>${esc(primary.reason)}</p>${alternatives.length?`<p><strong>Alternatifler:</strong> ${alternatives.map(item=>`${esc(item.market)} %${esc(item.probability)}`).join(' · ')}</p>`:''}</section>`;}
function topScores(rows=[]){return rows.length?`<section class="analysis-panel"><h3>En olası beş skor</h3><div class="market-grid">${rows.slice(0,5).map(x=>`<span>${esc(x.score)}<b>${valueOrDash(x.probability,'%')}</b></span>`).join('')}</div></section>`:'';}
function standingsTable(value={}){if(!value.available)return `<section class="analysis-panel"><h3>Puan durumu</h3><p class="detail-meta">Güncel tablo doğrulanamadı; sıralama üretilmedi.</p></section>`;const rows=[value.home,value.away].filter(Boolean);return `<section class="analysis-panel"><h3>Puan durumu</h3><table><tr><th>Takım</th><th>Sıra</th><th>O</th><th>G-B-M</th><th>AG-YG</th><th>Av.</th><th>P</th><th>PPM</th><th>Son 5</th></tr>${rows.map(r=>`<tr><td>${esc(r.team)}</td><td>${r.rank}</td><td>${r.played}</td><td>${r.wins}-${r.draws}-${r.losses}</td><td>${r.goalsFor}-${r.goalsAgainst}</td><td>${r.goalDifference}</td><td>${r.points}</td><td>${r.pointsPerMatch.toFixed(2)}</td><td>${esc(r.last5)}</td></tr>`).join('')}</table></section>`;}
function absenceTable(value={home:[],away:[]}){const rows=[...(value.home||[]).map(x=>({...x,side:'Ev'})),...(value.away||[]).map(x=>({...x,side:'Dep.'}))];return `<section class="analysis-panel"><h3>Eksik oyuncular</h3>${rows.length?`<table><tr><th>Taraf</th><th>Oyuncu</th><th>Durum</th><th>Önem</th><th>Etki</th></tr>${rows.map(x=>`<tr><td>${x.side}</td><td>${esc(x.name)}</td><td>${esc(x.type||x.reason||'Eksik')}</td><td>${esc(x.importance?.classification||'Doğrulanamadı')}</td><td>${x.importance?.score==null?'Doğrulanamadı':(x.importance.score*100).toFixed(0)+'%'}</td></tr>`).join('')}</table>`:'<p class="detail-meta">Doğrulanmış eksik oyuncu kaydı yok.</p>'}</section>`;}
function h2hTable(value){return `<section class="analysis-panel"><h3>Son iki yıllık H2H · ${value.played} maç</h3><table><tr><th>Tarih</th><th>Maç</th><th>Skor</th><th>İY</th><th>2,5</th><th>KG</th></tr>${value.matches.map(x=>`<tr><td>${trDate(x.date)}</td><td>${esc(x.home)} – ${esc(x.away)}</td><td>${x.score}</td><td>${x.halfTimeScore||'—'}</td><td>${x.over25?'Üst':'Alt'}</td><td>${x.btts?'Var':'Yok'}</td></tr>`).join('')}</table></section>`;}
function modelTable(value={}){const row=(name,x)=>`<tr><td>${name}</td><td>${x?.probabilities?x.probabilities.map(v=>valueOrDash(v,'%')).join(' / '):'Veri kaynağında bulunamadı'}</td></tr>`;return `<section class="analysis-panel"><h3>Model ayrıntısı · 1 / X / 2</h3><p>${value.dixonColes?.rhoFitted?'Dixon–Coles düzeltmesi uygulandı':'Standart Poisson'} · Ev lambda: ${valueOrDash(value.dixonColes?.lambdaHome)} · Deplasman lambda: ${valueOrDash(value.dixonColes?.lambdaAway)}</p><table>${row('Gol modeli',value.dixonColes)}${row('Elo',value.elo)}${row('ML',value.ml)}${row('Piyasa',value.market)}${row('Birleşik model',value.ensemble)}</table>${value.scoreMatrix?`<h3>Skor matrisi (%) · satır ev, sütun deplasman</h3><table><tr><th>Ev / Dep.</th>${[0,1,2,3,4,5].map(n=>`<th>${n}</th>`).join('')}</tr>${value.scoreMatrix.map((r,h)=>`<tr><th>${h}</th>${r.map(p=>`<td>${valueOrDash(p)}</td>`).join('')}</tr>`).join('')}</table><p>5 gol üzerindeki sonuçların toplam payı: %${valueOrDash(value.scoreMatrixOutside)} · Devre skoru örneği: ${valueOrDash(value.phaseSamples)} maç</p>`:''}</section>`;}
function recommendation(value){return value?.primary?`<section class="decision"><span>ANA ÖNERİ</span><h3>${esc(value.primary.market)}</h3><p>Güven: %${esc(value.primary.confidence)}</p><p>${esc(value.primary.reason)}</p></section>`:'<section class="decision decision-pass"><span>ANALİZ SONUCU</span><h3>Pas geç</h3><p>Güvenilir öneri üretmek için yeterli veri yok.</p></section>';}
async function prepareCoupon(surprise=false){const dialog=$('#couponDialog');$('#couponContent').innerHTML='<div class="loading">Maçlar değerlendiriliyor…</div>';dialog.showModal();try{const query=new URLSearchParams({league:state.selectedLeague});if(surprise)query.set('type','surprise');const data=await getJson(`/api/coupon?${query}`);const reasons=Object.entries(data.eliminationReasons||{}).map(([reason,count])=>`${esc(reason)}: ${count}`).join(' · ');$('#couponContent').innerHTML=`<p class="eyebrow">${surprise?'SÜRPRİZ KUPON':'TEK TUŞLA KUPON'}</p><h2>${esc(data.headline)}</h2><p class="detail-meta">${data.analyzed} maç analiz edildi · ${data.eliminated||0} maç elendi${reasons?' · '+reasons:''}</p>${data.picks?.length?`<div class="coupon-list">${data.picks.map((pick,index)=>`<article><span>${index+1}</span><div><h3>${esc(pick.home)} – ${esc(pick.away)}</h3><strong>${esc(pick.selection)}</strong><p>Olasılık: %${esc(pick.confidence)} · ${esc(pick.reason)}</p></div></article>`).join('')}</div>`:'<p>Analiz için yeterli geçmiş veri bulunamadı.</p>'}`;}catch(error){$('#couponContent').innerHTML='<h2>Analiz için yeterli geçmiş veri bulunamadı.</h2>';}}

$('#refresh').onclick=()=>loadMatches(true); $('#couponButton').onclick=()=>prepareCoupon(false); $('#surpriseButton').onclick=()=>prepareCoupon(true); $('.detail-close').onclick=()=>$('#detailDialog').close(); $('.coupon-close').onclick=()=>$('#couponDialog').close(); init();
