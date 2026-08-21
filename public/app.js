const state = { leagues: [], matches: [], selected: 'all', source: 'demo' };
const $ = s => document.querySelector(s);

async function init() {
  const config = await fetch('/api/config').then(r => r.json());
  state.leagues = config.leagues;
  renderFilters();
  await loadMatches();
}

async function loadMatches(refresh = false) {
  $('#refresh').disabled = true;
  $('#sourceStatus').textContent = 'Veriler yükleniyor';
  try {
    const data = await fetch(`/api/matches?refresh=${refresh ? 1 : 0}`).then(r => { if (!r.ok) throw new Error('Veriler alınamadı'); return r.json(); });
    state.matches = data.matches; state.source = data.source;
    $('#sourceStatus').textContent = data.source === 'demo' ? 'Demo veri modu' : data.source === 'tff-sportscore' ? 'TFF + SportScore bağlı' : 'API-Football bağlı';
    $('#updatedAt').textContent = `Güncelleme: ${new Date(data.updatedAt).toLocaleString('tr-TR')}`;
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
    $('#notice').classList.toggle('show', data.source === 'demo' || data.source === 'tff-sportscore' || warnings.length > 0);
    if (warnings.length) {
      $('#notice').textContent = `Bazı liglerin verisi alınamadı: ${warnings.join(' · ')}`;
    } else if (data.source === 'tff-sportscore') {
      $('#notice').innerHTML = 'API anahtarı girilmediği için yalnızca Süper Lig gösteriliyor. Ayarlar’dan API-Football anahtarını kaydedebilirsiniz. <a href="https://sportscore.com/" target="_blank" style="color:inherit">Powered by SportScore</a>';
    } else if (data.source === 'demo') {
      $('#notice').textContent = 'Demo modu açık. Veri kaynaklarına erişim kontrol edilmeli.';
    } else {
      $('#notice').textContent = '';
    }
    render();
  } catch (e) { $('#notice').classList.add('show'); $('#notice').textContent = e.message; }
  finally { $('#refresh').disabled = false; }
}

function renderFilters() {
  const all = [{ id: 'all', name: 'Tümü', flag: '◉' }, ...state.leagues];
  $('#leagueFilters').innerHTML = all.map(l => `<button class="filter ${String(l.id) === state.selected ? 'active' : ''}" data-id="${l.id}">${l.flag} ${l.name}</button>`).join('');
  document.querySelectorAll('.filter').forEach(b => b.onclick = () => { state.selected = b.dataset.id; renderFilters(); render(); });
}

function render() {
  const items = state.selected === 'all' ? state.matches : state.matches.filter(m => String(m.leagueId) === state.selected);
  $('#matchCount').textContent = items.length;
  $('#matches').innerHTML = items.length ? items.map(card).join('') : '<div class="empty">Bu lig için önümüzdeki 7 günde maç bulunamadı.</div>';
  const scored = items.filter(x => x.homeScore != null);
  $('#bestHome').textContent = maxBy(scored, 'homeScore')?.home || 'Analiz bekleniyor';
  $('#bestGoals').textContent = maxBy(scored, 'over25') ? `${maxBy(scored, 'over25').home} – ${maxBy(scored, 'over25').away}` : 'Analiz bekleniyor';
  $('#avgConfidence').textContent = scored.length ? `${Math.round(scored.reduce((a,x) => a+x.confidence,0)/scored.length)}/10` : '—';
  document.querySelectorAll('.match').forEach(el => el.onclick = () => showDetail(el.dataset.id));
}

function card(m) {
  const league = state.leagues.find(l => l.id === m.leagueId);
  const date = new Date(m.date);
  return `<article class="match" data-id="${m.id}"><div class="match-head"><span class="league">${league?.flag || ''} ${league?.name || ''}</span><span>${date.toLocaleDateString('tr-TR',{day:'2-digit',month:'short'})} · ${date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="teams"><div class="team">${logo(m.homeLogo)}${m.home}</div><div class="versus">VS</div><div class="team">${logo(m.awayLogo)}${m.away}</div></div><div class="metrics">${metric('Ev avantajı',m.homeScore)}${metric('2.5 Üst',m.over25)}${metric('KG Var',m.btts)}</div></article>`;
}
function logo(src) { return src ? `<img src="${src}" alt="">` : ''; }
function metric(label,value) { return `<div class="metric"><strong>${value == null ? '—' : `%${value}`}</strong><span>${label}</span><div class="bar"><i style="width:${value || 0}%"></i></div></div>`; }
function maxBy(items,key) { return items.reduce((best,x) => !best || x[key] > best[key] ? x : best, null); }
async function showDetail(id) {
  const m=state.matches.find(x=>String(x.id)===String(id)),l=state.leagues.find(x=>x.id===m.leagueId);
  $('#dialogContent').innerHTML='<div class="loading">Ayrıntılı veriler analiz ediliyor…</div>'; $('#detailDialog').showModal();
  try { const a=await fetch(`/api/analysis?id=${encodeURIComponent(id)}`).then(r=>{if(!r.ok)throw new Error('Analiz alınamadı');return r.json()});
    $('#dialogContent').innerHTML=`<p class="eyebrow">${l.name}</p><h2>${m.home} – ${m.away}</h2><p class="detail-meta">${new Date(m.date).toLocaleString('tr-TR')} · ${m.venue}<br>Hakem: ${m.referee}</p>${a.demo?'<p class="notice show">Örnek analiz gösteriliyor. Gerçek sonuç için API anahtarını Ayarlar bölümüne girin.</p>':''}<div class="analysis-scores">${score('Ev avantajı',a.scores.homeAdvantage)}${score('2.5 Üst',a.scores.over25)}${score('KG Var',a.scores.btts)}${score('İlk yarı gol',a.scores.firstHalf)}${score('İkinci yarı gol',a.scores.secondHalf)}${score('Veri güveni',a.scores.confidence)}</div><div class="analysis-cols"><section class="analysis-panel"><h3>Form ve gol</h3>${formTable(m.home,a.home)}${formTable(m.away,a.away)}</section><section class="analysis-panel"><h3>İkili rekabet</h3><p>${a.h2h.played} maç: ${m.home} ${a.h2h.homeWins}G, ${a.h2h.draws}B, ${m.away} ${a.h2h.awayWins}G</p><p>Gol ortalaması: ${a.h2h.goalsAvg} · 2.5 Üst: %${a.h2h.over25}</p><h3>Hakem geçmişi</h3><p>${a.referee.home.referee}<br>${m.home}: ${a.referee.home.matches} maç / ${a.referee.home.wins} galibiyet<br>${m.away}: ${a.referee.away.matches} maç / ${a.referee.away.wins} galibiyet</p></section><section class="analysis-panel"><h3>Sakat / cezalı</h3>${missing(m.home,a.injuries.home)}${missing(m.away,a.injuries.away)}</section><section class="analysis-panel"><h3>Son 3 maç oyuncu performansı</h3>${players(m.home,a.players.home)}${players(m.away,a.players.away)}</section></div>`;
    const predicted=a.predictedResult;
    if(predicted){$('#dialogContent .detail-meta').insertAdjacentHTML('afterend',`<section class="verdict"><span>MUHTEMEL MAÇ SONUCU</span><strong>${predicted.code} · ${predicted.label} (%${predicted.confidence})</strong><small>1: Ev sahibi · 0: Beraberlik · 2: Deplasman</small></section>`)}
    if(a.verdict){$('#dialogContent .detail-meta').insertAdjacentHTML('afterend',`<section class="verdict"><span>ANALİZ SONUCU</span><strong>${a.verdict}</strong></section>`)}
    if(a.recommendation) $('#dialogContent .detail-meta').insertAdjacentHTML('afterend',recommendation(a.recommendation));
    if(a.lineup||a.sources) $('#dialogContent .analysis-cols').insertAdjacentHTML('beforeend',enrichment(a,m));
  } catch(e){$('#dialogContent').innerHTML=`<h2>Analiz oluşturulamadı</h2><p>${e.message}</p><p class="detail-meta">Veri bağlantısını kontrol edin.</p>`}
}
function recommendation(r){const picks=(r.picks||[]).map(p=>`<li><strong>${r.primary&&p.market===r.primary.market?'ANA: ':'ZAYIF ALTERNATİF: '}${p.market}</strong> · güven %${p.confidence} · risk ${p.risk}<small>${p.reason}</small></li>`).join('');return `<section class="decision ${r.action==='PAS GEÇ'?'decision-pass':''}"><span>NE YAPMALIYIM?</span><h3>${r.action}</h3><p><b>Risk:</b> ${r.risk} · <b>Önerilen toplam miktar:</b> ${r.stake}</p>${picks?`<ol>${picks}</ol>`:'<p>Bu maç için yeterince güçlü seçenek bulunamadı.</p>'}${r.avoid?.length?`<p><b>Uzak dur:</b> ${r.avoid.join(' · ')}</p>`:''}${r.comboWarning?`<p class="decision-warning">${r.comboWarning}</p>`:''}${r.warnings?.length?`<ul class="decision-warnings">${r.warnings.map(x=>`<li>${x}</li>`).join('')}</ul>`:''}</section>`}
function enrichment(a,m){const l=a.lineup||{},team=(name,rows)=>`<h4>${name}</h4>${rows?.length?`<p class="lineup-list">${rows.map(x=>`${x.number}. ${x.name}`).join(' · ')}</p>`:'<p class="detail-meta">Henüz açıklanmadı.</p>'}`;const sources=(a.sources||[]).map(x=>`<a href="${x.url}" target="_blank">${x.name}: ${x.fields.join(', ')}</a>`).join('<br>');return `<section class="analysis-panel"><h3>Hakem ve kesin kadro</h3><p><b>Hakem:</b> ${a.currentReferee||'Henüz açıklanmadı'}</p><p class="${l.confirmed?'source-ok':'detail-meta'}">${l.confirmed?'✓ Kesin ilk 11 TFF tarafından doğrulandı':'Kadro henüz kesinleşmedi'}</p>${team(m.home,l.home)}${team(m.away,l.away)}</section><section class="analysis-panel"><h3>Veri doğrulama</h3><p>${sources||'Doğrulanmış ek kaynak yok.'}</p>${a.enrichmentErrors?.length?`<p class="decision-warning">${a.enrichmentErrors.join('<br>')}</p>`:''}</section>`}
function score(label,v){return `<div class="score-box"><strong>%${v}</strong><span>${label}</span></div>`}
function formTable(name,x){return `<h4>${name} · ${x.form||'—'}</h4><table><tr><td>Maç / G-B-M</td><td>${x.played} / ${x.wins}-${x.draws}-${x.losses}</td></tr><tr><td>Attığı / yediği gol</td><td>${x.goalsForAvg} / ${x.goalsAgainstAvg}</td></tr><tr><td>İY / 2Y gol</td><td>${x.firstHalfAvg} / ${x.secondHalfAvg}</td></tr></table>`}
function missing(name,rows){return `<h4>${name} (${rows.length})</h4>${rows.length?`<ul>${rows.map(x=>`<li>${x.name}: ${x.reason||x.type||'Belirtilmedi'}</li>`).join('')}</ul>`:'<p class="detail-meta">Kayıtlı eksik yok.</p>'}`}
function players(name,rows){return `<h4>${name}</h4>${rows.length?`<table>${rows.map(x=>`<tr><td>${x.name}</td><td>${x.rating||'—'} puan · ${x.goals}G ${x.assists}A</td></tr>`).join('')}</table>`:'<p class="detail-meta">Oyuncu verisi bulunamadı.</p>'}`}
$('#refresh').onclick = () => loadMatches(true);
$('#couponButton').onclick=async()=>{const button=$('#couponButton');button.disabled=true;$('#couponContent').innerHTML='<div class="loading">Bütün maçlar tek tek analiz ediliyor…</div>';$('#couponDialog').showModal();try{const c=await fetch('/api/coupon').then(r=>{if(!r.ok)throw new Error('Kupon analizi alınamadı');return r.json()});$('#couponContent').innerHTML=`<p class="eyebrow">OTOMATİK KUPON ANALİZİ</p><h2>${c.headline}</h2><p class="detail-meta">${c.analyzed} maç incelendi · ${new Date(c.generatedAt).toLocaleString('tr-TR')}</p>${c.picks.length?`<div class="coupon-list">${c.picks.map((p,i)=>`<article><span>${i+1}</span><div><h3>${p.home} – ${p.away}</h3><strong>${p.selection}</strong><p>Güven: %${p.confidence} · ${p.reason}</p><small>${p.lineupConfirmed?'Kesin kadro doğrulandı':'Kesin kadro henüz açıklanmadı'} · ${p.sources.join(', ')||'Temel istatistikler'}</small></div></article>`).join('')}</div>`:'<p class="notice show">Bugün güven eşiğini geçen seçim yok. Kupon yapmamak en doğru sonuçtur.</p>'}<p class="decision-warning">${c.warning}</p>`}catch(e){$('#couponContent').innerHTML=`<h2>Analiz tamamlanamadı</h2><p>${e.message}</p>`}finally{button.disabled=false}};
$('#surpriseButton').onclick=async()=>{const button=$('#surpriseButton');button.disabled=true;$('#couponContent').innerHTML='<div class="loading">Sürpriz olabilecek maçlar aranıyor…</div>';$('#couponDialog').showModal();try{const c=await fetch('/api/coupon?type=surprise').then(r=>{if(!r.ok)throw new Error('Sürpriz kupon analizi alınamadı');return r.json()});$('#couponContent').innerHTML=`<p class="eyebrow surprise-text">YÜKSEK RİSKLİ SÜRPRİZ KUPON</p><h2>${c.headline}</h2><p class="detail-meta">${c.analyzed} maç incelendi · oran kullanılmıyor</p>${c.picks.length?`<div class="coupon-list surprise-list">${c.picks.map((p,i)=>`<article><span>${i+1}</span><div><h3>${p.home} – ${p.away}</h3><strong>${p.selection}</strong><p>İstatistik puanı: %${p.confidence} · ${p.reason}</p><small>${p.lineupConfirmed?'Kesin kadro doğrulandı':'Kesin kadro henüz açıklanmadı'}</small></div></article>`).join('')}</div>`:'<p class="notice show">Bugün sürpriz kupon için uygun maç bulunamadı.</p>'}<p class="decision-warning">${c.warning}</p>`}catch(e){$('#couponContent').innerHTML=`<h2>Analiz tamamlanamadı</h2><p>${e.message}</p>`}finally{button.disabled=false}};
$('.coupon-close').onclick=()=>$('#couponDialog').close();
$('.close').onclick = () => $('#detailDialog').close();
$('#settingsButton').onclick=()=>$('#settingsDialog').showModal();
$('.settings-close').onclick=()=>$('#settingsDialog').close();
$('#saveSettings').onclick=async()=>{const key=$('#apiKey').value.trim();$('#settingsMessage').textContent='Kaydediliyor…';const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key})});if(r.ok){$('#settingsMessage').textContent='Kaydedildi. Gerçek veriler yükleniyor…';await loadMatches(true);setTimeout(()=>$('#settingsDialog').close(),700)}else $('#settingsMessage').textContent='Kaydedilemedi.'};
init();
