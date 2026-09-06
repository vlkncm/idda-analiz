'use strict';

const ISTANBUL_TIME_ZONE = 'Europe/Istanbul';

const LEAGUES = [
  { id: 203, code: 'TR-SL', name: 'Süper Lig', country: 'Türkiye', flag: '🇹🇷', espnSlug: 'tur.1', footballDataCode: null, sportsDbId: 4339, seasonStartMonth: 7 },
  { id: 39, code: 'EN-PL', name: 'Premier League', country: 'İngiltere', flag: '🇬🇧', espnSlug: 'eng.1', footballDataCode: 'PL', sportsDbId: 4328, seasonStartMonth: 7 },
  { id: 140, code: 'ES-LL', name: 'La Liga', country: 'İspanya', flag: '🇪🇸', espnSlug: 'esp.1', footballDataCode: 'PD', sportsDbId: 4335, seasonStartMonth: 7 },
  { id: 78, code: 'DE-BL', name: 'Bundesliga', country: 'Almanya', flag: '🇩🇪', espnSlug: 'ger.1', footballDataCode: 'BL1', sportsDbId: 4331, seasonStartMonth: 7 },
  { id: 135, code: 'IT-SA', name: 'Serie A', country: 'İtalya', flag: '🇮🇹', espnSlug: 'ita.1', footballDataCode: 'SA', sportsDbId: 4332, seasonStartMonth: 7 },
  { id: 61, code: 'FR-L1', name: 'Ligue 1', country: 'Fransa', flag: '🇫🇷', espnSlug: 'fra.1', footballDataCode: 'FL1', sportsDbId: 4334, seasonStartMonth: 7 }
];

const TEAM_ALIASES = new Map(Object.entries({
  'manchester united': 'Manchester United', 'man utd': 'Manchester United',
  'man united': 'Manchester United', 'ein frankfurt': 'Frankfurt', 'hamburg sv': 'Hamburg',
  'nott m forest': 'Nottingham Forest', 'nottingham forest': 'Nottingham Forest',
  'west ham united': 'West Ham', 'west ham': 'West Ham',
  'leeds united': 'Leeds', leeds: 'Leeds', 'leicester city': 'Leicester', leicester: 'Leicester',
  'hull city': 'Hull', hull: 'Hull', 'sunderland afc': 'Sunderland',
  'borussia dortmund': 'Dortmund', dortmund: 'Dortmund',
  'eintracht frankfurt': 'Frankfurt', frankfurt: 'Frankfurt',
  'schalke 04': 'Schalke 04', schalke: 'Schalke 04',
  'sc paderborn 07': 'Paderborn', paderborn: 'Paderborn',
  'hamburger sv': 'Hamburg', hamburg: 'Hamburg',
  'rb leipzig': 'RB Leipzig', 'rasenballsport leipzig': 'RB Leipzig',
  'celta vigo': 'Celta', 'celta de vigo': 'Celta', celta: 'Celta',
  sociedad: 'Real Sociedad',
  espanyol: 'Espanyol', espanol: 'Espanyol',
  'racing santander': 'Santander', santander: 'Santander',
  'stade rennais': 'Rennes', 'stade rennais football club': 'Rennes', rennes: 'Rennes',
  'olympique lyonnais': 'Lyon', lyon: 'Lyon',
  'stade brestois 29': 'Brest', brest: 'Brest',
  'as monaco': 'Monaco', monaco: 'Monaco',
  'rc strasbourg alsace': 'Strasbourg', 'rc strasbourg': 'Strasbourg', strasbourg: 'Strasbourg',
  'rc lens': 'Lens', lens: 'Lens', 'lille osc': 'Lille', lille: 'Lille',
  'manchester city': 'Manchester City', 'man city': 'Manchester City',
  'newcastle united': 'Newcastle United', newcastle: 'Newcastle United',
  'afc bournemouth': 'Bournemouth', bournemouth: 'Bournemouth',
  'ipswich town': 'Ipswich Town', ipswich: 'Ipswich Town',
  'tottenham hotspur': 'Tottenham', 'tottenham': 'Tottenham',
  'brighton hove albion': 'Brighton', 'brighton and hove albion': 'Brighton',
  'wolverhampton wanderers': 'Wolverhampton', wolves: 'Wolverhampton',
  'paris saint germain': 'PSG', 'paris sg': 'PSG', psg: 'PSG',
  'olympique marseille': 'Marseille', 'olympique de marseille': 'Marseille',
  'aj auxerre': 'Auxerre', auxerre: 'Auxerre', 'le havre ac': 'Le Havre', 'le havre': 'Le Havre',
  'bayern munchen': 'Bayern Munich', 'bayern munih': 'Bayern Munich', 'bayern munich': 'Bayern Munich',
  'borussia monchengladbach': 'Borussia Monchengladbach',
  'borussia m gladbach': 'Borussia Monchengladbach', 'm gladbach': 'Borussia Monchengladbach',
  'vfb stuttgart': 'Stuttgart', stuttgart: 'Stuttgart',
  'bayer leverkusen': 'Leverkusen', leverkusen: 'Leverkusen',
  '1 union berlin': 'Union Berlin', 'union berlin': 'Union Berlin',
  'tsg hoffenheim': 'Hoffenheim', hoffenheim: 'Hoffenheim',
  'sc freiburg': 'Freiburg', freiburg: 'Freiburg',
  koln: 'Koln', cologne: 'Koln', 'fc cologne': 'Koln', '1 koln': 'Koln',
  internazionale: 'Inter', 'internazionale milano': 'Inter', 'inter milan': 'Inter', inter: 'Inter',
  milan: 'AC Milan', 'ac milan': 'AC Milan',
  'atletico de madrid': 'Atletico Madrid', 'club atletico de madrid': 'Atletico Madrid', 'atletico madrid': 'Atletico Madrid', 'ath madrid': 'Atletico Madrid',
  'athletic club': 'Athletic Bilbao', 'athletic bilbao': 'Athletic Bilbao', 'ath bilbao': 'Athletic Bilbao',
  'real betis balompie': 'Real Betis', 'real betis': 'Real Betis',
  betis: 'Real Betis', 'rayo vallecano': 'Rayo Vallecano', vallecano: 'Rayo Vallecano',
  'real sociedad de futbol': 'Real Sociedad', 'real sociedad': 'Real Sociedad',
  fenerbahce: 'Fenerbahçe', galatasaray: 'Galatasaray', besiktas: 'Beşiktaş',
  trabzonspor: 'Trabzonspor', 'istanbul basaksehir': 'Başakşehir', 'istanbul buyuksehir belediyespor': 'Başakşehir', buyuksehyr: 'Başakşehir', basaksehir: 'Başakşehir',
  'erzurumspor bb': 'Erzurumspor', 'erzurum bb': 'Erzurumspor', 'bb erzurumspor': 'Erzurumspor', erzurumspor: 'Erzurumspor',
  'tumosan konyaspor': 'Konyaspor', konyaspor: 'Konyaspor'
}));

function fold(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/\b(tumosan|rams|corendon|onvo|ikas|arca|bellona|sipay|futbol kulubu)\b/g, ' ')
    .replace(/\b(a\.?s\.?|fc|cf|fk|sk|jk)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function canonicalTeamName(value) {
  const original = String(value || '').replace(/\s+/g, ' ').trim();
  return TEAM_ALIASES.get(fold(original)) || original;
}

function sameTeam(left, right) {
  const a = canonicalTeamName(left), b = canonicalTeamName(right);
  return Boolean(a && b && fold(a) === fold(b));
}

function seasonForDate(value, league) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const month = date.getUTCMonth() + 1;
  const start = month >= (league?.seasonStartMonth || 7) ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${start}-${start + 1}`;
}

const STATUS = {
  STATUS_SCHEDULED: 'SCHEDULED', STATUS_POSTPONED: 'POSTPONED', STATUS_CANCELED: 'CANCELLED', STATUS_CANCELLED: 'CANCELLED', STATUS_SUSPENDED: 'SUSPENDED', STATUS_FINAL: 'FINISHED', STATUS_IN_PROGRESS: 'LIVE', STATUS_HALFTIME: 'PAUSED',
  SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED', NS: 'SCHEDULED', TBD: 'SCHEDULED',
  LIVE: 'LIVE', IN_PLAY: 'LIVE', PAUSED: 'PAUSED', '1H': 'LIVE', HT: 'PAUSED', '2H': 'LIVE', ET: 'LIVE', BT: 'LIVE', P: 'LIVE',
  FINISHED: 'FINISHED', FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED',
  POSTPONED: 'POSTPONED', PST: 'POSTPONED', SUSPENDED: 'SUSPENDED', SUSP: 'SUSPENDED',
  CANCELLED: 'CANCELLED', CANC: 'CANCELLED', ABD: 'SUSPENDED', AWD: 'FINISHED', WO: 'FINISHED'
};

function normalizeStatus(value) { return STATUS[String(value || 'SCHEDULED').toUpperCase()] || 'SCHEDULED'; }

function normalizeFixture(input, { provider, league, fetchedAt = new Date().toISOString() }) {
  const kickoff = new Date(input.kickoffUtc || input.date || input.kickoff);
  const home = canonicalTeamName(input.home);
  const away = canonicalTeamName(input.away);
  if (!league) throw new Error('Desteklenmeyen lig');
  if (!home || !away || sameTeam(home, away)) throw new Error('Ev sahibi veya deplasman takımı geçersiz');
  if (!Number.isFinite(kickoff.getTime())) throw new Error('Maç tarihi geçersiz');
  const providerMatchId = String(input.providerMatchId || input.id || '').trim();
  if (!providerMatchId) throw new Error('Provider maç kimliği eksik');
  const kickoffUtc = kickoff.toISOString();
  return {
    id: `${provider}:${providerMatchId}`,
    provider,
    providerMatchId,
    leagueId: league.id,
    leagueName: league.name,
    country: league.country,
    season: input.season || seasonForDate(kickoffUtc, league),
    round: input.round == null ? null : String(input.round),
    home,
    away,
    homeLogo: input.homeLogo || '',
    awayLogo: input.awayLogo || '',
    kickoffUtc,
    date: kickoffUtc,
    timezone: 'UTC',
    status: normalizeStatus(input.status),
    venue: input.venue || 'Belirtilmedi',
    referee: input.referee || 'Henüz atanmadı',
    homeScore: input.homeScore == null ? null : Number(input.homeScore),
    awayScore: input.awayScore == null ? null : Number(input.awayScore),
    source: input.source || provider,
    sourceUrl: input.sourceUrl || '',
    fetchedAt,
    over25: null,
    btts: null,
    confidence: null,
    demo: false
  };
}

function deduplicateFixtures(matches) {
  const seenProvider = new Set(), result = [];
  for (const match of matches) {
    const providerKey = `${match.provider}|${match.leagueId}|${match.providerMatchId}`;
    if (seenProvider.has(providerKey)) continue;
    seenProvider.add(providerKey);
    const index = result.findIndex(existing => existing.leagueId === match.leagueId && sameTeam(existing.home, match.home) && sameTeam(existing.away, match.away) && Math.abs(new Date(existing.kickoffUtc) - new Date(match.kickoffUtc)) <= 15 * 60 * 1000);
    if (index < 0) { result.push(match); continue; }
    const existing = result[index];
    const useful = value => value != null && value !== '' && value !== 'Belirtilmedi' && value !== 'Henüz atanmadı';
    result[index] = {
      ...match,
      ...existing,
      homeLogo: useful(existing.homeLogo) ? existing.homeLogo : match.homeLogo,
      awayLogo: useful(existing.awayLogo) ? existing.awayLogo : match.awayLogo,
      venue: useful(existing.venue) ? existing.venue : match.venue,
      city: useful(existing.city) ? existing.city : match.city,
      referee: useful(existing.referee) ? existing.referee : match.referee,
      homeScore: existing.homeScore ?? match.homeScore,
      awayScore: existing.awayScore ?? match.awayScore,
      fieldSources: { ...(match.fieldSources || {}), ...(existing.fieldSources || {}), primary: existing.provider }
    };
  }
  return result.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
}

function dateKeyInZone(value, timeZone = ISTANBUL_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addCalendarDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeBounds(range = '14', now = new Date()) {
  const today = dateKeyInZone(now);
  if (range === 'today') return { from: today, to: today };
  if (range === 'tomorrow') { const tomorrow = addCalendarDays(today, 1); return { from: tomorrow, to: tomorrow }; }
  if (range === 'week') {
    const noon = new Date(`${today}T12:00:00Z`);
    const mondayOffset = (noon.getUTCDay() + 6) % 7;
    return { from: today, to: addCalendarDays(today, 6 - mondayOffset) };
  }
  return { from: today, to: addCalendarDays(today, 14) };
}

function filterFixtures(matches, { league = 'all', range = '14', now = new Date() } = {}) {
  const bounds = rangeBounds(range, now);
  return matches.filter(match => {
    const key = dateKeyInZone(match.kickoffUtc);
    const kickoff = new Date(match.kickoffUtc).getTime();
    return match.status === 'SCHEDULED' && kickoff > now.getTime() && key >= bounds.from && key <= bounds.to && (league === 'all' || String(match.leagueId) === String(league));
  });
}

module.exports = { ISTANBUL_TIME_ZONE, LEAGUES, TEAM_ALIASES, fold, canonicalTeamName, sameTeam, seasonForDate, normalizeStatus, normalizeFixture, deduplicateFixtures, dateKeyInZone, addCalendarDays, rangeBounds, filterFixtures };
