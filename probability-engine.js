'use strict';

const { sameTeam, canonicalTeamName } = require('./fixture-providers/model');

const LN2 = Math.log(2);
const EPSILON = 1e-12;
const artifactCache = new Map();

function finite(value) { return value !== null && value !== '' && Number.isFinite(Number(value)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function weightedMean(values) {
  const usable = values.filter(item => finite(item.value) && finite(item.weight) && item.weight > 0);
  const denominator = sum(usable.map(item => Number(item.weight)));
  return denominator ? sum(usable.map(item => Number(item.value) * Number(item.weight))) / denominator : null;
}
function recencyWeight(ageDays, halfLifeDays = 180) { return Math.exp(-LN2 * Math.max(0, ageDays) / halfLifeDays); }
function isoTime(value) { const time = new Date(value).getTime(); return Number.isFinite(time) ? time : null; }
function seasonStart(value) { const date = new Date(value); return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1; }
function canonical(value) { return canonicalTeamName ? canonicalTeamName(value) : String(value || '').trim(); }

function normalizeHistory(rows, kickoff) {
  const cutoff = isoTime(kickoff);
  const unique = new Map();
  for (const input of rows || []) {
    const playedAt = isoTime(input.playedAt ?? input.kickoff ?? input.date);
    if (!finite(input.homeGoals ?? input.home_score) || !finite(input.awayGoals ?? input.away_score)) continue;
    const homeGoals = Number(input.homeGoals ?? input.home_score);
    const awayGoals = Number(input.awayGoals ?? input.away_score);
    if (!input.home || !input.away || !finite(homeGoals) || !finite(awayGoals) || homeGoals < 0 || awayGoals < 0) continue;
    if (playedAt === null || (cutoff !== null && playedAt >= cutoff)) continue;
    const row = {
      leagueId: Number(input.leagueId), season: input.season ?? seasonStart(playedAt), playedAt: new Date(playedAt).toISOString(),
      home: canonical(input.home), away: canonical(input.away), homeGoals, awayGoals,
      halfTimeHomeGoals: finite(input.halfTimeHomeGoals ?? input.home_ht) ? Number(input.halfTimeHomeGoals ?? input.home_ht) : null,
      halfTimeAwayGoals: finite(input.halfTimeAwayGoals ?? input.away_ht) ? Number(input.halfTimeAwayGoals ?? input.away_ht) : null,
      homeXg: finite(input.homeXg ?? input.home_xg) ? Number(input.homeXg ?? input.home_xg) : null,
      awayXg: finite(input.awayXg ?? input.away_xg) ? Number(input.awayXg ?? input.away_xg) : null,
      homeShots: finite(input.homeShots ?? input.home_shots) ? Number(input.homeShots ?? input.home_shots) : null,
      awayShots: finite(input.awayShots ?? input.away_shots) ? Number(input.awayShots ?? input.away_shots) : null,
      homeShotsOnTarget: finite(input.homeShotsOnTarget ?? input.home_shots_on_target) ? Number(input.homeShotsOnTarget ?? input.home_shots_on_target) : null,
      awayShotsOnTarget: finite(input.awayShotsOnTarget ?? input.away_shots_on_target) ? Number(input.awayShotsOnTarget ?? input.away_shots_on_target) : null,
      homeRedCards: finite(input.homeRedCards ?? input.home_red_cards) ? Number(input.homeRedCards ?? input.home_red_cards) : null,
      awayRedCards: finite(input.awayRedCards ?? input.away_red_cards) ? Number(input.awayRedCards ?? input.away_red_cards) : null,
      competitionType: input.competitionType || 'league', source: input.source || null
    };
    unique.set(`${row.leagueId}|${playedAt}|${row.home}|${row.away}`, row);
  }
  return [...unique.values()].sort((a, b) => isoTime(a.playedAt) - isoTime(b.playedAt));
}

function teamRows(history, team, venue = 'all', limit = 10) {
  return history.filter(row => venue === 'home' ? sameTeam(row.home, team) : venue === 'away' ? sameTeam(row.away, team) : sameTeam(row.home, team) || sameTeam(row.away, team)).slice(-limit);
}

function venueStats(history, team, venue, asOf, limit = 10, halfLifeDays = 180) {
  const rows = teamRows(history, team, venue, limit);
  if (!rows.length) return { played: 0, wins: 0, draws: 0, losses: 0, winRate: null, drawRate: null, lossRate: null, pointsPerMatch: null, goalsForAvg: null, goalsAgainstAvg: null, scoredRate: null, cleanSheetRate: null, over25: null, btts: null, lowConfidence: true };
  const observations = rows.map(row => {
    const isHome = sameTeam(row.home, team), goalsFor = isHome ? row.homeGoals : row.awayGoals, goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    return { row, goalsFor, goalsAgainst, weight: recencyWeight((isoTime(asOf) - isoTime(row.playedAt)) / 86400000, halfLifeDays) };
  });
  const weightTotal = sum(observations.map(row => row.weight));
  const ratio = predicate => sum(observations.filter(predicate).map(row => row.weight)) / weightTotal;
  const wins = observations.filter(row => row.goalsFor > row.goalsAgainst).length;
  const draws = observations.filter(row => row.goalsFor === row.goalsAgainst).length;
  const losses = rows.length - wins - draws;
  return {
    played: rows.length, wins, draws, losses, winRate: ratio(row => row.goalsFor > row.goalsAgainst), drawRate: ratio(row => row.goalsFor === row.goalsAgainst), lossRate: ratio(row => row.goalsFor < row.goalsAgainst),
    pointsPerMatch: weightedMean(observations.map(row => ({ value: row.goalsFor > row.goalsAgainst ? 3 : row.goalsFor === row.goalsAgainst ? 1 : 0, weight: row.weight }))),
    goalsForAvg: weightedMean(observations.map(row => ({ value: row.goalsFor, weight: row.weight }))), goalsAgainstAvg: weightedMean(observations.map(row => ({ value: row.goalsAgainst, weight: row.weight }))),
    scoredRate: ratio(row => row.goalsFor > 0), cleanSheetRate: ratio(row => row.goalsAgainst === 0), over25: ratio(row => row.goalsFor + row.goalsAgainst >= 3), btts: ratio(row => row.goalsFor > 0 && row.goalsAgainst > 0),
    form: observations.map(row => row.goalsFor > row.goalsAgainst ? 'W' : row.goalsFor < row.goalsAgainst ? 'L' : 'D').join(''), lowConfidence: rows.length < 3
  };
}

function currentStandings(history, kickoff) {
  const targetSeason = seasonStart(kickoff);
  const rows = history.filter(row => Number(row.season) === targetSeason && row.competitionType === 'league');
  if (!rows.length) return null;
  const table = new Map();
  const get = team => { const key = canonical(team); if (!table.has(key)) table.set(key, { team: key, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, homePoints: 0, homePlayed: 0, awayPoints: 0, awayPlayed: 0, recent: [] }); return table.get(key); };
  for (const row of rows) {
    const home = get(row.home), away = get(row.away), draw = row.homeGoals === row.awayGoals, homeWin = row.homeGoals > row.awayGoals;
    for (const item of [home, away]) item.played++;
    home.goalsFor += row.homeGoals; home.goalsAgainst += row.awayGoals; away.goalsFor += row.awayGoals; away.goalsAgainst += row.homeGoals;
    const hp = draw ? 1 : homeWin ? 3 : 0, ap = draw ? 1 : homeWin ? 0 : 3;
    home.points += hp; away.points += ap; home.homePoints += hp; home.homePlayed++; away.awayPoints += ap; away.awayPlayed++;
    draw ? (home.draws++, away.draws++) : homeWin ? (home.wins++, away.losses++) : (away.wins++, home.losses++);
    home.recent.push({ at: row.playedAt, result: hp === 3 ? 'W' : hp === 1 ? 'D' : 'L' }); away.recent.push({ at: row.playedAt, result: ap === 3 ? 'W' : ap === 1 ? 'D' : 'L' });
  }
  const ranked = [...table.values()].sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor);
  const homeRanked = [...table.values()].sort((a, b) => (b.homePoints / Math.max(1, b.homePlayed)) - (a.homePoints / Math.max(1, a.homePlayed)));
  const awayRanked = [...table.values()].sort((a, b) => (b.awayPoints / Math.max(1, b.awayPlayed)) - (a.awayPoints / Math.max(1, a.awayPlayed)));
  return ranked.map((row, index) => ({ ...row, rank: index + 1, goalDifference: row.goalsFor - row.goalsAgainst, pointsPerMatch: row.points / row.played, last5: row.recent.slice(-5).map(item => item.result).join(''), homeRank: homeRanked.indexOf(row) + 1, awayRank: awayRanked.indexOf(row) + 1 }));
}

function findStanding(table, team) { return table?.find(row => sameTeam(row.team, team)) || null; }
function leagueAverages(history, asOf, halfLifeDays = 180) {
  const leagueRows = history.filter(row => row.competitionType === 'league');
  const home = weightedMean(leagueRows.map(row => ({ value: row.homeGoals, weight: recencyWeight((isoTime(asOf) - isoTime(row.playedAt)) / 86400000, halfLifeDays) })));
  const away = weightedMean(leagueRows.map(row => ({ value: row.awayGoals, weight: recencyWeight((isoTime(asOf) - isoTime(row.playedAt)) / 86400000, halfLifeDays) })));
  return { home: home ?? 1.45, away: away ?? 1.15, matches: leagueRows.length };
}

function expectedGoals(history, homeTeam, awayTeam, kickoff, halfLifeDays = 180) {
  const averages = leagueAverages(history, kickoff, halfLifeDays);
  const home = venueStats(history, homeTeam, 'home', kickoff, 10, halfLifeDays), away = venueStats(history, awayTeam, 'away', kickoff, 10, halfLifeDays);
  if (home.played < 3 || away.played < 3) return { home: null, away: null, averages, strengths: null };
  const strengths = { homeAttack: home.goalsForAvg / averages.home, homeDefenceWeakness: home.goalsAgainstAvg / averages.away, awayAttack: away.goalsForAvg / averages.away, awayDefenceWeakness: away.goalsAgainstAvg / averages.home };
  return { home: clamp(averages.home * strengths.homeAttack * strengths.awayDefenceWeakness, 0.15, 4.5), away: clamp(averages.away * strengths.awayAttack * strengths.homeDefenceWeakness, 0.15, 4.5), averages, strengths };
}

function poisson(goals, lambda) { let factorial = 1; for (let i = 2; i <= goals; i++) factorial *= i; return Math.exp(-lambda) * lambda ** goals / factorial; }
function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}
function fitRho(history, halfLifeDays = 180) {
  if (history.length < 80) return { rho: 0, fitted: false, fallback: 'Yetersiz örnek; bağımsız Poisson kullanıldı.' };
  const latest = isoTime(history.at(-1).playedAt), observations = [];
  for (let index = Math.max(40, history.length - 500); index < history.length; index++) {
    const row = history[index]; if (row.homeGoals > 1 || row.awayGoals > 1) continue;
    const expected = expectedGoals(history.slice(0, index), row.home, row.away, row.playedAt, halfLifeDays);
    if (expected.home !== null) observations.push({ row, lambdaHome: expected.home, lambdaAway: expected.away });
  }
  if (observations.length < 20) return { rho: 0, fitted: false, fallback: 'Düşük skor rho fit örneği yetersiz; bağımsız Poisson kullanıldı.' };
  let best = { rho: 0, loss: Infinity };
  for (let rho = -0.2; rho <= 0.2 + EPSILON; rho += 0.01) {
    let loss = 0;
    for (const { row, lambdaHome, lambdaAway } of observations) {
      const probability = poisson(row.homeGoals, lambdaHome) * poisson(row.awayGoals, lambdaAway) * dixonColesTau(row.homeGoals, row.awayGoals, lambdaHome, lambdaAway, rho);
      if (probability <= 0) { loss = Infinity; break; }
      loss -= recencyWeight((latest - isoTime(row.playedAt)) / 86400000, halfLifeDays) * Math.log(probability);
    }
    if (loss < best.loss) best = { rho: Number(rho.toFixed(2)), loss };
  }
  return Number.isFinite(best.loss) ? { rho: best.rho, fitted: true, fallback: null } : { rho: 0, fitted: false, fallback: 'Rho optimizasyonu başarısız; bağımsız Poisson kullanıldı.' };
}

function scoreMatrix(lambdaHome, lambdaAway, rho = 0, maxGoals = 10) {
  const matrix = Array.from({ length: maxGoals + 1 }, (_, h) => Array.from({ length: maxGoals + 1 }, (_, a) => Math.max(0, poisson(h, lambdaHome) * poisson(a, lambdaAway) * dixonColesTau(h, a, lambdaHome, lambdaAway, rho))));
  const total = sum(matrix.flat());
  return matrix.map(row => row.map(value => value / total));
}
function matrixMarkets(matrix, lambdaHome, lambdaAway) {
  let home = 0, draw = 0, away = 0, over15 = 0, over25 = 0, over35 = 0, btts = 0, home05 = 0, away05 = 0;
  const scores = [];
  matrix.forEach((row, h) => row.forEach((probability, a) => {
    h > a ? home += probability : h === a ? draw += probability : away += probability;
    if (h + a >= 2) over15 += probability; if (h + a >= 3) over25 += probability; if (h + a >= 4) over35 += probability;
    if (h > 0 && a > 0) btts += probability; if (h > 0) home05 += probability; if (a > 0) away05 += probability;
    scores.push({ score: `${h}-${a}`, probability });
  }));
  return { home, draw, away, oneX: home + draw, xTwo: draw + away, twelve: home + away, over15, under15: 1 - over15, over25, under25: 1 - over25, over35, under35: 1 - over35, bttsYes: btts, bttsNo: 1 - btts, homeOver05: home05, awayOver05: away05, expectedHomeGoals: lambdaHome, expectedAwayGoals: lambdaAway, topScores: scores.sort((a, b) => b.probability - a.probability).slice(0, 5) };
}

class EloEngine {
  constructor({ initial = 1500, k = 24, homeAdvantage = 65 } = {}) { this.initial = initial; this.k = k; this.homeAdvantage = homeAdvantage; this.ratings = new Map(); }
  rating(team) { const key = canonical(team); if (!this.ratings.has(key)) this.ratings.set(key, this.initial); return this.ratings.get(key); }
  predict(home, away) {
    const difference = this.rating(home) + this.homeAdvantage - this.rating(away), decisiveHome = 1 / (1 + 10 ** (-difference / 400));
    const draw = clamp(0.29 - Math.abs(difference) / 2500, 0.16, 0.3);
    return [decisiveHome * (1 - draw), draw, (1 - decisiveHome) * (1 - draw)];
  }
  update(row) {
    const home = this.rating(row.home), away = this.rating(row.away), expected = 1 / (1 + 10 ** (-(home + this.homeAdvantage - away) / 400));
    const actual = row.homeGoals > row.awayGoals ? 1 : row.homeGoals === row.awayGoals ? 0.5 : 0, goalMultiplier = Math.min(1.75, 1 + Math.max(0, Math.abs(row.homeGoals - row.awayGoals) - 1) * 0.15), change = this.k * goalMultiplier * (actual - expected);
    this.ratings.set(canonical(row.home), home + change); this.ratings.set(canonical(row.away), away - change);
  }
  process(rows) {
    let activeSeason = null;
    for (const row of [...rows].sort((a, b) => isoTime(a.playedAt) - isoTime(b.playedAt))) {
      if (activeSeason !== null && row.season !== activeSeason) for (const [team, rating] of this.ratings) this.ratings.set(team, this.initial + 0.75 * (rating - this.initial));
      activeSeason = row.season; this.update(row);
    }
    return this;
  }
}

function normalizeProbabilities(values) { const safe = values.map(value => Math.max(EPSILON, Number(value) || 0)), total = sum(safe); return safe.map(value => value / total); }
function temperatureScale(probabilities, temperature) { return normalizeProbabilities(probabilities.map(value => Math.exp(Math.log(Math.max(EPSILON, value)) / temperature))); }
function logLoss(rows) { return rows.length ? -sum(rows.map(row => Math.log(Math.max(EPSILON, row.probabilities[row.target])))) / rows.length : null; }
function brier(rows) { return rows.length ? sum(rows.map(row => sum(row.probabilities.map((value, index) => (value - (index === row.target ? 1 : 0)) ** 2)))) / rows.length : null; }
function evaluationMetrics(rows) {
  if (!rows.length) return { samples: 0, logLoss: null, brier: null, rankedProbabilityScore: null, calibrationError: null, accuracy: null, drawPrecision: null, drawRecall: null };
  let correct = 0, drawPredicted = 0, drawTrue = 0, drawTruePositive = 0, rps = 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  for (const item of rows) {
    const predicted = item.probabilities.indexOf(Math.max(...item.probabilities)), confidence = item.probabilities[predicted];
    correct += predicted === item.target; drawPredicted += predicted === 1; drawTrue += item.target === 1; drawTruePositive += predicted === 1 && item.target === 1;
    rps += ((item.probabilities[0] - (item.target === 0 ? 1 : 0)) ** 2 + (item.probabilities[0] + item.probabilities[1] - (item.target <= 1 ? 1 : 0)) ** 2) / 2;
    const bin = bins[Math.min(9, Math.floor(confidence * 10))]; bin.count++; bin.confidence += confidence; bin.correct += predicted === item.target;
  }
  const calibrationError = sum(bins.filter(bin => bin.count).map(bin => bin.count / rows.length * Math.abs(bin.correct / bin.count - bin.confidence / bin.count)));
  return { samples: rows.length, logLoss: logLoss(rows), brier: brier(rows), rankedProbabilityScore: rps / rows.length, calibrationError, accuracy: correct / rows.length, drawPrecision: drawPredicted ? drawTruePositive / drawPredicted : null, drawRecall: drawTrue ? drawTruePositive / drawTrue : null };
}
function resultTarget(row) { return row.homeGoals > row.awayGoals ? 0 : row.homeGoals === row.awayGoals ? 1 : 2; }
function blend(first, second, weight) { return normalizeProbabilities(first.map((value, index) => weight * value + (1 - weight) * second[index])); }
function legacyProbabilities(history, row) {
  const home = venueStats(history, row.home, 'home', row.playedAt), away = venueStats(history, row.away, 'away', row.playedAt);
  if (home.played < 2 || away.played < 2) return null;
  const advantage = clamp(52 + (home.wins - away.wins) * 4 + (home.goalsForAvg - away.goalsForAvg) * 6, 25, 75), sample = home.played + away.played, drawRate = sample ? (home.draws + away.draws) / sample * 100 : 30;
  const draw = clamp(38 - Math.abs(50 - advantage) * 0.65 + (drawRate - 30) * 0.35, 18, 42) / 100, remaining = 1 - draw, homeProbability = remaining * advantage / 100;
  return normalizeProbabilities([homeProbability, draw, remaining - homeProbability]);
}

function validationForecasts(train, evaluate, halfLifeDays, rho) {
  const known = [...train], elo = new EloEngine().process(train), output = [];
  for (const row of evaluate) {
    const lambdas = expectedGoals(known, row.home, row.away, row.playedAt, halfLifeDays);
    if (lambdas.home !== null) {
      const dcMarkets = matrixMarkets(scoreMatrix(lambdas.home, lambdas.away, rho), lambdas.home, lambdas.away);
      output.push({ dc: [dcMarkets.home, dcMarkets.draw, dcMarkets.away], markets: dcMarkets, elo: elo.predict(row.home, row.away), legacy: legacyProbabilities(known, row), target: resultTarget(row), row });
    }
    known.push(row); elo.update(row);
  }
  return output;
}

function trainArtifact(history, halfLifeDays = 180) {
  if (history.length < 150) return { available: false, promoted: false, reason: 'Model artifact’i için en az 150 tarihli lig maçı gerekli.' };
  const trainEnd = Math.floor(history.length * 0.6), validationEnd = Math.floor(history.length * 0.8), train = history.slice(0, trainEnd), validation = history.slice(trainEnd, validationEnd), test = history.slice(validationEnd);
  const rhoFit = fitRho(train, halfLifeDays), validationRows = validationForecasts(train, validation, halfLifeDays, rhoFit.rho);
  if (validationRows.length < 20) return { available: false, promoted: false, reason: 'Zaman sıralı validation için yeterli tahmin üretilemedi.', rho: rhoFit };
  let best = { loss: Infinity, weight: 0.5, temperature: 1 };
  for (let weight = 0; weight <= 1.0001; weight += 0.05) for (let temperature = 0.7; temperature <= 1.5001; temperature += 0.05) {
    const rows = validationRows.map(item => ({ target: item.target, probabilities: temperatureScale(blend(item.dc, item.elo, weight), temperature) }));
    const loss = logLoss(rows); if (loss < best.loss) best = { loss, weight: Number(weight.toFixed(2)), temperature: Number(temperature.toFixed(2)) };
  }
  const binaryDefinitions = {
    over15: row => row.homeGoals + row.awayGoals >= 2,
    over25: row => row.homeGoals + row.awayGoals >= 3,
    over35: row => row.homeGoals + row.awayGoals >= 4,
    bttsYes: row => row.homeGoals > 0 && row.awayGoals > 0,
    homeOver05: row => row.homeGoals > 0,
    awayOver05: row => row.awayGoals > 0
  };
  const binaryTemperatures = {};
  for (const [market, target] of Object.entries(binaryDefinitions)) {
    let optimum = { loss: Infinity, temperature: 1 };
    for (let temperature = 0.7; temperature <= 1.5001; temperature += 0.05) {
      const loss = -sum(validationRows.map(item => {
        const probability = temperatureScale([item.markets[market], 1 - item.markets[market]], temperature)[0];
        return Math.log(Math.max(EPSILON, target(item.row) ? probability : 1 - probability));
      })) / validationRows.length;
      if (loss < optimum.loss) optimum = { loss, temperature: Number(temperature.toFixed(2)) };
    }
    binaryTemperatures[market] = optimum.temperature;
  }
  const development = history.slice(0, validationEnd), rawTest = validationForecasts(development, test, halfLifeDays, rhoFit.rho), testRows = rawTest.map(item => ({ target: item.target, probabilities: temperatureScale(blend(item.dc, item.elo, best.weight), best.temperature) }));
  const baselineDistribution = normalizeProbabilities([sum(train.map(row => resultTarget(row) === 0)), sum(train.map(row => resultTarget(row) === 1)), sum(train.map(row => resultTarget(row) === 2))]);
  const baselineRows = testRows.map(row => ({ target: row.target, probabilities: baselineDistribution }));
  const legacyRows = rawTest.filter(item => item.legacy).map(item => ({ target: item.target, probabilities: item.legacy })), over25Rows = rawTest.map(item => { const probability = temperatureScale([item.markets.over25, 1 - item.markets.over25], binaryTemperatures.over25)[0]; return { target: item.row.homeGoals + item.row.awayGoals >= 3 ? 0 : 1, probabilities: [probability, 1 - probability] }; });
  const metrics = { ...evaluationMetrics(testRows), baseline: evaluationMetrics(baselineRows), legacy: evaluationMetrics(legacyRows), over25: { brier: brier(over25Rows), logLoss: logLoss(over25Rows) }, coverage: test.length ? testRows.length / test.length : 0, roi: null, maximumDrawdown: null, selections: 0 };
  const promoted = metrics.samples >= 20 && metrics.logLoss < metrics.baseline.logLoss && metrics.brier <= metrics.baseline.brier && (!metrics.legacy.samples || (metrics.logLoss < metrics.legacy.logLoss && metrics.brier <= metrics.legacy.brier));
  return { available: true, promoted, reason: promoted ? null : 'Yeni motor dokunulmamış test döneminde baseline’ı geçemedi.', rho: rhoFit, productionRho: fitRho(history, halfLifeDays), ensembleWeights: { dixonColes: best.weight, elo: 1 - best.weight, ml: 0, market: 0 }, calibration: { method: 'temperature-scaling', temperature: best.temperature, binaryTemperatures, fittedOn: 'validation' }, split: { train: train.length, validation: validation.length, test: test.length }, metrics };
}

function cachedArtifact(history, halfLifeDays) {
  const last = history.at(-1), key = `${last?.leagueId || 'league'}|${history.length}|${last?.playedAt || 'empty'}|${halfLifeDays}`;
  if (!artifactCache.has(key)) {
    // Dört sezon feature hesabında korunur; kalibrasyonun karesel walk-forward
    // maliyeti masaüstünü kilitlemesin diye en yeni 400 lig maçıyla sınırlanır.
    artifactCache.set(key, trainArtifact(history.slice(-400), halfLifeDays));
    while (artifactCache.size > 12) artifactCache.delete(artifactCache.keys().next().value);
  }
  return artifactCache.get(key);
}

function h2h(history, homeTeam, awayTeam, kickoff) {
  const cutoff = isoTime(kickoff) - 2 * 365.25 * 86400000;
  const matches = history.filter(row => isoTime(row.playedAt) >= cutoff && ((sameTeam(row.home, homeTeam) && sameTeam(row.away, awayTeam)) || (sameTeam(row.home, awayTeam) && sameTeam(row.away, homeTeam))));
  if (!matches.length) return null;
  let homeWins = 0, draws = 0, awayWins = 0;
  const details = matches.map(row => {
    const currentHomeGoals = sameTeam(row.home, homeTeam) ? row.homeGoals : row.awayGoals, currentAwayGoals = sameTeam(row.away, awayTeam) ? row.awayGoals : row.homeGoals;
    currentHomeGoals > currentAwayGoals ? homeWins++ : currentHomeGoals === currentAwayGoals ? draws++ : awayWins++;
    const total = row.homeGoals + row.awayGoals;
    return { date: row.playedAt, home: row.home, away: row.away, score: `${row.homeGoals}-${row.awayGoals}`, halfTimeScore: row.halfTimeHomeGoals === null || row.halfTimeAwayGoals === null ? null : `${row.halfTimeHomeGoals}-${row.halfTimeAwayGoals}`, totalGoals: total, over25: total >= 3, btts: row.homeGoals > 0 && row.awayGoals > 0 };
  });
  return { played: matches.length, homeWins, draws, awayWins, goalsAverage: sum(matches.map(row => row.homeGoals + row.awayGoals)) / matches.length, over25Rate: sum(matches.map(row => row.homeGoals + row.awayGoals >= 3 ? 1 : 0)) / matches.length, bttsRate: sum(matches.map(row => row.homeGoals > 0 && row.awayGoals > 0 ? 1 : 0)) / matches.length, weight: matches.length <= 2 ? 'very-low' : 'low', matches: details };
}

function fatigue(history, team, kickoff) {
  const rows = teamRows(history, team, 'all', 20), cutoff = isoTime(kickoff), last = rows.at(-1), restDays = last ? Math.floor((cutoff - isoTime(last.playedAt)) / 86400000) : null;
  return { restDays, matchesLast7Days: rows.filter(row => cutoff - isoTime(row.playedAt) <= 7 * 86400000).length, matchesLast14Days: rows.filter(row => cutoff - isoTime(row.playedAt) <= 14 * 86400000).length, fatigueClass: restDays === null ? 'unknown' : restDays <= 2 ? 'high' : restDays === 3 ? 'medium' : restDays <= 5 ? 'normal' : 'rested', travelLoad: null };
}

function xgFeatures(history, team, venue, kickoff, halfLifeDays = 180) {
  const candidates = teamRows(history, team, venue, 20).filter(row => row.homeXg !== null && row.awayXg !== null);
  if (!candidates.length) return { available: false, source: null, last5: null, last10: null, venueXg: null, venueXga: null, goalMinusXg: null, xgPerShot: null, shotsOnTargetTrend: null };
  const sources = new Map(); for (const row of candidates) sources.set(row.source || 'unknown', (sources.get(row.source || 'unknown') || 0) + 1);
  const source = [...sources].sort((a, b) => b[1] - a[1])[0][0], rows = candidates.filter(row => (row.source || 'unknown') === source).slice(-10);
  const observations = rows.map(row => { const isHome = sameTeam(row.home, team); return { xg: isHome ? row.homeXg : row.awayXg, xga: isHome ? row.awayXg : row.homeXg, goals: isHome ? row.homeGoals : row.awayGoals, shots: isHome ? row.homeShots : row.awayShots, sot: isHome ? row.homeShotsOnTarget : row.awayShotsOnTarget, weight: recencyWeight((isoTime(kickoff) - isoTime(row.playedAt)) / 86400000, halfLifeDays) }; });
  const summarize = sample => weightedMean(sample.map(row => ({ value: row.xg, weight: row.weight }))), last5Rows = observations.slice(-5), shots = weightedMean(observations.filter(row => row.shots > 0).map(row => ({ value: row.xg / row.shots, weight: row.weight })));
  const recentSot = weightedMean(last5Rows.filter(row => row.sot !== null).map(row => ({ value: row.sot, weight: row.weight }))), priorSot = weightedMean(observations.slice(-10, -5).filter(row => row.sot !== null).map(row => ({ value: row.sot, weight: row.weight })));
  const xg = summarize(observations);
  return { available: true, source, samples: observations.length, last5: summarize(last5Rows), last10: xg, venueXg: xg, venueXga: weightedMean(observations.map(row => ({ value: row.xga, weight: row.weight }))), goalMinusXg: weightedMean(observations.map(row => ({ value: row.goals - row.xg, weight: row.weight }))), xgPerShot: shots, shotsOnTargetTrend: recentSot !== null && priorSot !== null ? recentSot - priorSot : null };
}

function playerImportance(player) {
  const required = ['minutesShare', 'startShare', 'goalContributionShare', 'assistContributionShare', 'ratingPercentile', 'positionCriticality', 'keyRoleIndicator'];
  if (!required.every(key => finite(player?.[key]))) return { score: null, classification: 'Doğrulanamadı', verified: false };
  const score = 0.30 * player.minutesShare + 0.20 * player.startShare + 0.15 * player.goalContributionShare + 0.10 * player.assistContributionShare + 0.10 * player.ratingPercentile + 0.10 * player.positionCriticality + 0.05 * player.keyRoleIndicator;
  return { score, classification: score >= 0.75 ? 'Çok kritik' : score >= 0.5 ? 'Önemli' : score >= 0.25 ? 'Rotasyon' : 'Sınırlı etki', verified: true };
}
function assessAbsences(injuries) { return { home: (injuries?.home || []).map(player => ({ ...player, importance: playerImportance(player) })), away: (injuries?.away || []).map(player => ({ ...player, importance: playerImportance(player) })) }; }

function dataQuality({ history, homeStats, awayStats, standings, homeTeam, awayTeam, artifact, xgAvailable, injuriesAvailable, oddsAvailable, kickoff }) {
  const homeCount = teamRows(history, homeTeam, 'all', 1000).length, awayCount = teamRows(history, awayTeam, 'all', 1000).length;
  const standingSamples = standings ? Math.min(...standings.map(row => row.played)) : 0;
  const components = { history: Math.min(1, Math.min(homeCount, awayCount) / 10), venue: Math.min(1, Math.min(homeStats.played, awayStats.played) / 8), recency: history.some(row => isoTime(kickoff) - isoTime(row.playedAt) <= 240 * 86400000) ? 1 : 0.4, teamMatch: homeCount && awayCount ? 1 : 0, standings: standings ? Math.min(1, standingSamples / 8) : 0, xg: xgAvailable ? 1 : 0, injuries: injuriesAvailable ? 1 : 0, odds: oddsAvailable ? 1 : 0, artifact: artifact?.promoted ? 1 : 0 };
  const weights = { history: 20, venue: 18, recency: 12, teamMatch: 15, standings: 10, xg: 5, injuries: 5, odds: 5, artifact: 10 };
  return { score: Math.round(sum(Object.keys(weights).map(key => components[key] * weights[key]))), components, homeHistoryMatches: homeCount, awayHistoryMatches: awayCount };
}
function entropyConfidence(probabilities) { const entropy = -sum(probabilities.map(value => value * Math.log(Math.max(EPSILON, value)))) / Math.log(3); return Math.round((1 - entropy) * 100); }
function disagreement(first, second) { return Math.max(...first.map((value, index) => Math.abs(value - second[index]))); }
function percent(value) { return value === null ? null : Number((100 * value).toFixed(1)); }

const RECOMMENDATION_MARKETS = Object.freeze([
  ['1X', 'oneX'], ['X2', 'xTwo'], ['Maç sonucu 1', 'home'], ['Maç sonucu X', 'draw'], ['Maç sonucu 2', 'away'],
  ['2,5 Alt', 'under25'], ['2,5 Üst', 'over25'], ['KG Var', 'bttsYes'], ['KG Yok', 'bttsNo'],
  ['İlk yarı 0,5 Üst', 'firstHalfOver05'], ['İkinci yarı 0,5 Üst', 'secondHalfOver05']
]);

function explainSelection(name, homeStats, awayStats, lambdas) {
  if (name === '1X') return `Ev sahibinin iç saha, rakibin deplasman verileri ev sahibi yenilmezliğini öne çıkarıyor.`;
  if (name === 'X2') return `Deplasman takımının dış saha verileri ev sahibi galibiyetine karşı daha güçlü.`;
  if (name.includes('2,5')) return `Poisson gol beklentisi ${lambdas.home.toFixed(2)} + ${lambdas.away.toFixed(2)} ve son iç/dış saha gol eğilimleri bu pazarı destekliyor.`;
  if (name.startsWith('KG')) return `Takımların iç/dış saha gol atma ve yeme eğilimleri birlikte değerlendirildi.`;
  if (name.includes('yarı')) return `Yalnız devre skoru bulunan gerçek lig maçlarındaki gol zamanlaması kullanıldı.`;
  return `Poisson, Elo ve ${homeStats.played + awayStats.played} uygun iç/dış saha maçı birlikte değerlendirildi.`;
}

function rankSelections(markets, quality, homeStats, awayStats, lambdas) {
  const ranked = RECOMMENDATION_MARKETS.flatMap(([market, key]) => finite(markets[key]) ? [{ market, key, probability: percent(markets[key]) }] : [])
    .sort((left, right) => right.probability - left.probability);
  const primary = ranked[0] || null;
  if (!primary) return { decision: 'YÜKSEK RİSK', primary: null, alternatives: [] };
  const decision = primary.probability >= 70 && quality.score >= 65 ? 'GÜÇLÜ SEÇENEK' : primary.probability >= 58 && quality.score >= 45 ? 'TEMKİNLİ SEÇENEK' : 'YÜKSEK RİSK';
  const risk = decision === 'GÜÇLÜ SEÇENEK' ? 'Düşük' : decision === 'TEMKİNLİ SEÇENEK' ? 'Orta' : 'Yüksek';
  const decorate = item => ({ ...item, dataConfidence: quality.score, usedMatches: { homeVenue: homeStats.played, awayVenue: awayStats.played, total: homeStats.played + awayStats.played }, risk, reason: explainSelection(item.market, homeStats, awayStats, lambdas) });
  return { decision, primary: decorate(primary), alternatives: ranked.slice(1, 4).map(decorate) };
}

function analyzeMatch({ match, rows, injuries = { home: [], away: [] }, odds = null, halfLifeDays = 180 }) {
  const kickoff = match.kickoffUtc || match.date, history = normalizeHistory(rows, kickoff), status = String(match.statusCategory || match.status || '').toUpperCase();
  if (['POSTPONED', 'PST', 'CANCELLED', 'CANCELED', 'CANC', 'SUSPENDED', 'ABD'].includes(status)) return { analysisReady: false, decision: 'ANALİZ DIŞI', decisionReasons: ['Maç ertelenmiş, iptal edilmiş veya yarıda kalmış.'] };
  const homeStats = venueStats(history, match.home, 'home', kickoff), awayStats = venueStats(history, match.away, 'away', kickoff), homeLast5 = venueStats(history, match.home, 'home', kickoff, 5), awayLast5 = venueStats(history, match.away, 'away', kickoff, 5), lambdas = expectedGoals(history, match.home, match.away, kickoff, halfLifeDays), standings = currentStandings(history, kickoff), artifact = cachedArtifact(history, halfLifeDays);
  homeStats.windows = { last5: homeLast5, last10: { ...homeStats } }; awayStats.windows = { last5: awayLast5, last10: { ...awayStats } };
  const snapshotTime = isoTime(odds?.capturedAt), kickoffTime = isoTime(kickoff);
  const xgAvailable = history.some(row => row.homeXg !== null && row.awayXg !== null), injuriesAvailable = [...(injuries.home || []), ...(injuries.away || [])].some(player => playerImportance(player).verified), oddsAvailable = Boolean(odds && finite(odds.home) && finite(odds.draw) && finite(odds.away) && snapshotTime !== null && snapshotTime < kickoffTime && snapshotTime >= kickoffTime - 24 * 60 * 60 * 1000);
  const quality = dataQuality({ history, homeStats, awayStats, standings, homeTeam: match.home, awayTeam: match.away, artifact, xgAvailable, injuriesAvailable, oddsAvailable, kickoff });
  const reasons = [];
  if (homeStats.played < 3 || awayStats.played < 3 || lambdas.home === null) {
    const missing = [];
    if (homeStats.played < 3) missing.push(`${match.home} iç saha geçmişi ${homeStats.played}/3`);
    if (awayStats.played < 3) missing.push(`${match.away} deplasman geçmişi ${awayStats.played}/3`);
    reasons.push(...missing);
    return { engine: 'node-dixon-coles-elo-v1', legacy: false, analysisReady: true, productionReady: false, decision: 'VERİ YETERSİZ', decisionReasons: reasons, missingDataWarnings: missing, dataQualityScore: quality.score, dataQuality: quality, modelConfidence: null, calibrationConfidence: artifact.available ? 40 : null, marketEdge: null, overallConfidence: quality.score, home: homeStats, away: awayStats, usedMatches: { homeVenue: homeStats.played, awayVenue: awayStats.played, total: homeStats.played + awayStats.played }, standings: { available: Boolean(standings), home: findStanding(standings, match.home), away: findStanding(standings, match.away) }, h2h: h2h(history, match.home, match.away, kickoff), xg: { available: xgAvailable, message: xgAvailable ? null : 'Veri kaynağında bulunamadı' }, artifact };
  }
  if (!artifact.available || !artifact.promoted) reasons.push(`${artifact.reason} Standart Poisson ve Elo kullanıldı.`);
  const finalRho = artifact.productionRho || fitRho(history, halfLifeDays), matrix = scoreMatrix(lambdas.home, lambdas.away, finalRho.rho, 20), dc = matrixMarkets(matrix, lambdas.home, lambdas.away), eloEngine = new EloEngine().process(history), elo = eloEngine.predict(match.home, match.away);
  if (!finalRho.fitted) reasons.push(finalRho.fallback || 'Dixon–Coles düzeltmesi için veri yetersiz; standart Poisson kullanıldı.');
  const weight = artifact.promoted ? artifact.ensembleWeights.dixonColes : 0.7;
  const raw = blend([dc.home, dc.draw, dc.away], elo, weight), calibrated = artifact.promoted ? temperatureScale(raw, artifact.calibration.temperature) : raw, modelDisagreement = disagreement([dc.home, dc.draw, dc.away], elo);
  if (modelDisagreement > 0.2) reasons.push('Dixon–Coles ve Elo modelleri ciddi biçimde çelişiyor.');
  const modelConfidence = entropyConfidence(calibrated), calibrationConfidence = artifact.promoted ? (artifact.metrics.samples >= 40 ? 80 : 60) : null, overallConfidence = Math.round(0.7 * quality.score + 0.3 * modelConfidence);
  let value = null;
  if (oddsAvailable) {
    const market = removeVig(odds.home, odds.draw, odds.away), labels = ['1', 'X', '2'];
    value = labels.map((selection, index) => ({ selection, modelProbability: calibrated[index], fairMarketProbability: market[index], edge: calibrated[index] - market[index], expectedValue: calibrated[index] * [odds.home, odds.draw, odds.away][index] - 1, isValue: false, reason: 'Aynı eşik için pozitif walk-forward ROI doğrulanmadı.' })).sort((a, b) => b.expectedValue - a.expectedValue);
  }
  const phaseCandidates = [...teamRows(history, match.home, 'home', 10), ...teamRows(history, match.away, 'away', 10)];
  const halftimeRows = [...new Set(phaseCandidates)].filter(row => row.halfTimeHomeGoals !== null && row.halfTimeAwayGoals !== null && row.halfTimeHomeGoals <= row.homeGoals && row.halfTimeAwayGoals <= row.awayGoals);
  const smoothedPhaseRate = predicate => { const observations = halftimeRows.map(row => ({ value: predicate(row) ? 1 : 0, weight: recencyWeight((isoTime(kickoff) - isoTime(row.playedAt)) / 86400000, halfLifeDays) })); const weight = sum(observations.map(row => row.weight)); return (sum(observations.map(row => row.value * row.weight)) + 1) / (weight + 2); };
  const firstHalfOver05 = halftimeRows.length >= 6 ? smoothedPhaseRate(row => row.halfTimeHomeGoals + row.halfTimeAwayGoals > 0) : null;
  const secondHalfOver05 = halftimeRows.length >= 6 ? smoothedPhaseRate(row => (row.homeGoals + row.awayGoals) - (row.halfTimeHomeGoals + row.halfTimeAwayGoals) > 0) : null;
  const binary = (key, probability) => artifact.promoted ? temperatureScale([probability, 1 - probability], artifact.calibration.binaryTemperatures[key] || 1)[0] : probability;
  const over15 = binary('over15', dc.over15), over25 = binary('over25', dc.over25), over35 = binary('over35', dc.over35), bttsYes = binary('bttsYes', dc.bttsYes), homeOver05 = binary('homeOver05', dc.homeOver05), awayOver05 = binary('awayOver05', dc.awayOver05);
  const markets = { ...dc, home: calibrated[0], draw: calibrated[1], away: calibrated[2], oneX: calibrated[0] + calibrated[1], xTwo: calibrated[1] + calibrated[2], twelve: calibrated[0] + calibrated[2], over15, under15: 1 - over15, over25, under25: 1 - over25, over35, under35: 1 - over35, bttsYes, bttsNo: 1 - bttsYes, homeOver05, awayOver05, firstHalfOver05, secondHalfOver05 };
  const selection = rankSelections(markets, quality, homeStats, awayStats, lambdas);
  return {
    engine: 'node-dixon-coles-elo-v1', legacy: false, analysisReady: true, productionReady: true, calibrated: Boolean(artifact.promoted), decision: selection.decision, decisionReasons: reasons, missingDataWarnings: [!xgAvailable ? 'xG/xGA veri kaynağında bulunamadı; model ağırlığından çıkarıldı.' : null, !injuriesAvailable ? 'Sakat ve cezalı verisi doğrulanamadı; model ağırlığından çıkarıldı.' : null].filter(Boolean), primarySelection: selection.primary, alternativeSelections: selection.alternatives, riskLevel: selection.primary?.risk || 'Yüksek', usedMatches: selection.primary?.usedMatches, generatedAt: new Date().toISOString(), warning: 'Olasılıklar kesin sonuç veya kazanç garantisi değildir.',
    probabilities: Object.fromEntries(Object.entries(markets).filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, percent(value)])), expectedGoals: { home: Number(lambdas.home.toFixed(3)), away: Number(lambdas.away.toFixed(3)) }, topScores: dc.topScores.map(item => ({ score: item.score, probability: percent(item.probability) })),
    dataQualityScore: quality.score, dataQuality: quality, modelConfidence, calibrationConfidence, marketEdge: value?.[0]?.edge ? percent(value[0].edge) : null, overallConfidence, home: homeStats, away: awayStats,
    standings: { available: Boolean(standings), home: findStanding(standings, match.home), away: findStanding(standings, match.away) }, h2h: h2h(history, match.home, match.away, kickoff), fatigue: { home: fatigue(history, match.home, kickoff), away: fatigue(history, match.away, kickoff) },
    xg: { available: xgAvailable, message: xgAvailable ? null : 'Veri kaynağında bulunamadı', home: xgFeatures(history, match.home, 'home', kickoff, halfLifeDays), away: xgFeatures(history, match.away, 'away', kickoff, halfLifeDays) }, absences: assessAbsences(injuries), referee: match.referee ? { assigned: true, name: match.referee, statisticsAvailable: false } : { assigned: false, name: 'Henüz atanmadı', statisticsAvailable: false },
    modelDetails: { phaseSamples: halftimeRows.length, scoreMatrix: matrix.slice(0, 6).map(row => row.slice(0, 6).map(percent)), scoreMatrixOutside: percent(1 - sum(matrix.slice(0, 6).flatMap(row => row.slice(0, 6)))), dixonColes: { probabilities: [percent(dc.home), percent(dc.draw), percent(dc.away)], rho: finalRho.rho, rhoFitted: finalRho.fitted, lambdaHome: lambdas.home, lambdaAway: lambdas.away }, elo: { probabilities: elo.map(percent), config: { initial: 1500, k: 24, homeAdvantage: 65 } }, ml: null, market: oddsAvailable ? value : null, ensemble: { probabilities: calibrated.map(percent), weights: { dixonColes: weight, elo: 1 - weight }, calibrated: Boolean(artifact.promoted) } }, artifact, value
  };
}

function removeVig(...odds) { const raw = odds.map(value => { if (!finite(value) || Number(value) <= 1) throw new Error('Ondalık oran 1’den büyük olmalı.'); return 1 / Number(value); }); return normalizeProbabilities(raw); }
function shinProbabilities(...odds) {
  const inverse = odds.map(value => 1 / Number(value)); if (inverse.some(value => !finite(value) || value <= 0)) throw new Error('Geçersiz oran.');
  const overround = sum(inverse); if (overround <= 1) return normalizeProbabilities(inverse);
  let low = 0, high = 0.99;
  for (let iteration = 0; iteration < 100; iteration++) { const z = (low + high) / 2, probabilities = inverse.map(q => (Math.sqrt(z * z + 4 * (1 - z) * q * q / overround) - z) / (2 * (1 - z))), total = sum(probabilities); total > 1 ? low = z : high = z; }
  const z = (low + high) / 2; return normalizeProbabilities(inverse.map(q => (Math.sqrt(z * z + 4 * (1 - z) * q * q / overround) - z) / (2 * (1 - z))));
}

module.exports = { recencyWeight, normalizeHistory, venueStats, currentStandings, expectedGoals, poisson, dixonColesTau, fitRho, scoreMatrix, matrixMarkets, EloEngine, trainArtifact, h2h, fatigue, xgFeatures, playerImportance, assessAbsences, removeVig, shinProbabilities, rankSelections, analyzeMatch };
