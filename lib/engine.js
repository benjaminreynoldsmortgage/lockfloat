// ============================================================
// engine.js — Cook Inlet Lending Center Lock/Float engine
// Pure, testable functions. No network here. Backend feeds it data.
// ============================================================

const WINDOWS = [15, 30, 45, 60];

// ---- factor definitions: display metadata + horizon weights ----
// score convention everywhere: + = pushes rates UP / favors LOCK, - = favors FLOAT
const FACTOR_META = {
  trend:  { nm: "10Y Treasury — trend",   sub: "DGS10 level & direction",        w: { 15:1.0, 30:1.1, 45:1.1, 60:1.2 } },
  momo:   { nm: "Yield momentum",         sub: "5-day rate-of-change",           w: { 15:1.3, 30:1.0, 45:0.8, 60:0.7 } },
  vol:    { nm: "Rate volatility",        sub: "realized vol + headline risk",   w: { 15:1.2, 30:1.2, 45:1.1, 60:1.0 } },
  spread: { nm: "MBS / Treasury spread",  sub: "current-coupon basis",           w: { 15:0.9, 30:1.0, 45:1.0, 60:1.0 } },
  fed:    { nm: "Fed path",               sub: "fed funds + FOMC bias",          w: { 15:0.7, 30:1.0, 45:1.3, 60:1.5 } },
  infl:   { nm: "Inflation data",         sub: "CPI / PPI vs trend",             w: { 15:0.9, 30:1.1, 45:1.2, 60:1.3 } },
  oil:    { nm: "Oil / energy",           sub: "WTI direction",                  w: { 15:1.1, 30:0.9, 45:0.8, 60:0.7 } },
  cal:    { nm: "Data-calendar risk",     sub: "jobs / CPI / FOMC ahead",        w: { 15:0.8, 30:1.1, 45:1.2, 60:1.3 } },
  news:   { nm: "News sentiment",         sub: "US/world/industry headlines",    w: { 15:1.0, 30:1.0, 45:1.0, 60:1.0 } },
};

// ---------- derived factor scoring from raw numeric series ----------
// Each takes the latest readings + short history and returns an integer -2..+2.

function clampScore(x) { return Math.max(-2, Math.min(2, Math.round(x))); }

// trend: level relative to a recent band. Higher & rising = lock.
function scoreTrend(series10y) {
  if (!series10y || series10y.length < 20) return 0;
  const latest = series10y[series10y.length - 1];
  const window = series10y.slice(-60);
  const min = Math.min(...window), max = Math.max(...window);
  const pos = (latest - min) / Math.max(0.0001, (max - min)); // 0..1 within band
  // top of band -> lock(+), bottom -> float(-)
  return clampScore((pos - 0.5) * 4);
}

// momentum: 5-day change. Rising yields = lock(+).
function scoreMomentum(series10y) {
  if (!series10y || series10y.length < 6) return 0;
  const n = series10y.length;
  const chg = series10y[n - 1] - series10y[n - 6]; // 5 trading days, in %
  const bpPerDay = (chg * 100) / 5;
  // +5bp/day -> +2, -5 -> -2
  return clampScore(bpPerDay / 2.5);
}

// volatility: realized stdev of daily changes, scaled. High vol = lock(+).
function scoreVol(series10y, headlineRisk = 0) {
  if (!series10y || series10y.length < 11) return clampScore(headlineRisk);
  const diffs = [];
  for (let i = series10y.length - 10; i < series10y.length; i++)
    diffs.push((series10y[i] - series10y[i - 1]) * 100); // bp
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  // sd ~ >6bp/day is high -> +2; <2bp/day calm -> -1; plus headline overlay
  let s = (sd - 3.5) / 1.5 + headlineRisk;
  return clampScore(s);
}

// inflation: latest YoY vs the Fed's 2% target & recent direction. Hot = lock(+).
function scoreInflation(cpiYoY, ppiYoY, cpiPrev) {
  if (cpiYoY == null) return 0;
  let s = (cpiYoY - 2.0) * 0.9;                 // distance above target
  if (ppiYoY != null && ppiYoY > 4) s += 0.6;   // producer-pipeline pressure
  if (cpiPrev != null && cpiYoY > cpiPrev) s += 0.5; // accelerating
  return clampScore(s);
}

// fed: distance of fed funds from a neutral ~3.0 + explicit bias flag (-1..+1 from news).
function scoreFed(fedFunds, biasFlag = 0) {
  if (fedFunds == null) return clampScore(biasFlag * 2);
  // restrictive & not cutting = lock risk; bias flag dominates near-term
  let s = (fedFunds - 3.0) * 0.7 + biasFlag * 1.6;
  return clampScore(s);
}

// oil: 10-day % change in WTI. Rising oil = inflation = lock(+); falling = float(-).
function scoreOil(seriesWTI) {
  if (!seriesWTI || seriesWTI.length < 11) return 0;
  const n = seriesWTI.length;
  const pct = (seriesWTI[n - 1] - seriesWTI[n - 11]) / seriesWTI[n - 11] * 100;
  return clampScore(pct / 6); // +12% -> +2
}

// spread, cal, news arrive as direct -2..2 judgments (from proxy calc or AI).

// ---------- window verdict ----------
function scoreWindow(days, factors) {
  let num = 0, den = 0;
  for (const f of factors) {
    const w = (FACTOR_META[f.key]?.w?.[days]) ?? 1;
    num += f.score * w;
    den += 2 * w;
  }
  const norm = den ? num / den : 0; // -1..+1
  let verdict, cls, tag;
  if (norm >= 0.28)      { verdict = "Lock Now";        cls = "lock";    tag = "LOCK"; }
  else if (norm >= 0.08) { verdict = "Cautiously Float"; cls = "caution"; tag = "CAUTION"; }
  else                   { verdict = "Okay to Float";    cls = "float";   tag = "FLOAT"; }
  const signNum = Math.sign(num);
  const agree = factors.filter(f => Math.sign(f.score) === signNum && f.score !== 0).length /
                Math.max(1, factors.length);
  const conf = Math.round(Math.min(96, 52 + Math.abs(norm) * 60 + agree * 18));
  return { days, norm, verdict, cls, tag, conf };
}

// ---------- statistical forecast: drift + vol -> projected range per window ----------
// Defensible & simple: estimate daily drift and daily vol from recent history,
// project the 10Y forward over each window, return point + 1-sigma band.
// We forecast the 10Y (the thing that actually moves mortgage rates) and translate
// to a mortgage-rate proxy via the current spread.
function forecastRates(series10y, mortgageSpread = 2.7) {
  if (!series10y || series10y.length < 30) return null;
  const n = series10y.length;
  const recent = series10y.slice(-30);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) diffs.push(recent[i] - recent[i - 1]);
  const drift = diffs.reduce((a, b) => a + b, 0) / diffs.length;            // %/day
  const mean = drift;
  const vol = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  const last = series10y[n - 1];
  // dampen drift toward 0 (mean-reversion guard) so we don't extrapolate a spike
  const dampedDrift = drift * 0.4;
  const out = {};
  for (const d of WINDOWS) {
    const point10y = last + dampedDrift * d;
    const band = vol * Math.sqrt(d) * 1.0; // 1-sigma over the horizon
    out[d] = {
      tenYearPoint: +point10y.toFixed(2),
      tenYearLow:  +(point10y - band).toFixed(2),
      tenYearHigh: +(point10y + band).toFixed(2),
      mortgagePoint: +(point10y + mortgageSpread).toFixed(2),
      mortgageLow:  +(point10y - band + mortgageSpread).toFixed(2),
      mortgageHigh: +(point10y + band + mortgageSpread).toFixed(2),
      // direction confidence: how cleanly drift beats noise over the horizon
      confidence: Math.round(Math.min(90, 50 + Math.abs(dampedDrift * d) / Math.max(0.01, band) * 25)),
    };
  }
  return { drift: +(drift * 100).toFixed(1), volDaily: +(vol * 100).toFixed(1), out };
}

module.exports = {
  WINDOWS, FACTOR_META,
  scoreTrend, scoreMomentum, scoreVol, scoreInflation, scoreFed, scoreOil,
  scoreWindow, forecastRates, clampScore,
};
