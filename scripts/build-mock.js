// ============================================================
// scripts/build-mock.js — generates a public/mock-snapshot.json from
// realistic current readings, so you can open the dashboard locally
// (or drop it on any static host) BEFORE wiring up live APIs.
// Run: node scripts/build-mock.js
// ============================================================
const fs = require("fs");
const path = require("path");
const eng = require("../lib/engine.js");

// realistic seed series (June 2026 tape)
let s = []; let v = 4.30;
for (let i = 0; i < 60; i++) { v += Math.sin(i / 7) * 0.01 + 0.004; s.push(+v.toFixed(3)); }
s[s.length - 1] = 4.47; s[s.length - 2] = 4.53; s[s.length - 6] = 4.55;
const wti = []; let o = 78; for (let i = 0; i < 30; i++) { o -= 0.4; wti.push(+o.toFixed(2)); }

const factors = [
  { key: "trend",  score: eng.scoreTrend(s),                 val: "4.47%" },
  { key: "momo",   score: eng.scoreMomentum(s),              val: "-2.4 bp/day" },
  { key: "vol",    score: eng.scoreVol(s, 0.5),              val: "Elevated" },
  { key: "spread", score: 1,                                 val: "2.70 pts" },
  { key: "fed",    score: eng.scoreFed(3.625, 0.6),          val: "3.63%" },
  { key: "infl",   score: eng.scoreInflation(3.4, 6.5, 3.1), val: "CPI 3.4% · PPI 6.5%" },
  { key: "oil",    score: eng.scoreOil(wti),                 val: "WTI -14.6% / 10d" },
  { key: "cal",    score: 1,                                 val: "Heavy" },
  { key: "news",   score: 1,                                 val: "8 stories" },
].map(f => ({ ...f, nm: eng.FACTOR_META[f.key].nm, sub: eng.FACTOR_META[f.key].sub }));

const verdicts = eng.WINDOWS.map(d => eng.scoreWindow(d, factors));
const forecast = eng.forecastRates(s, 2.7);

const snapshot = {
  asOf: new Date().toISOString(),
  asOfLabel: new Date().toLocaleString("en-US", { timeZone: "America/Anchorage" }) + " AKT (mock)",
  headline: "Inflation is reaccelerating off a Middle-East oil shock (PPI at 2022 highs), the Fed has dropped its easing bias with hike odds rising, and today's lower rates ride on fragile peace headlines. Lock-biased, high-volatility tape: float only the shortest window, and only with discipline.",
  alaska: "Falling crude eases national inflation but pressures Alaska state revenue and North Slope employment — watch local purchase demand if the oil slide deepens.",
  factors, verdicts, forecast,
  readings: { tenYear: 4.47, fedFunds: 3.63, mortgage30: 7.17, cpiYoY: 3.4, ppiYoY: 6.5, spread: 2.70, wti: wti.slice(-1)[0] },
  history: { tenY: s.map((value, i) => ({ date: `d${i}`, value })) },
  headlines: [
    { title: "Treasury yields tumble as oil falls on Trump Iran reversal", source: "CNBC", url: "https://www.cnbc.com/quotes/US10Y" },
    { title: "Producer prices rise 6.5% year-on-year in May, highest since 2022", source: "Reuters", url: "https://tradingeconomics.com/united-states/producer-prices" },
    { title: "No bets left for a Fed rate cut in 2026; hike bets rising", source: "Investing.com", url: "https://www.investing.com/rates-bonds/u.s.-10-year-bond-yield" },
    { title: "High mortgage rates to keep US housing turnover subdued", source: "Reuters", url: "https://www.reuters.com/markets/us/" },
    { title: "FOMC held at 3.50–3.75%; 8-4 vote, easing bias removed", source: "Trading Economics", url: "https://www.federalreserve.gov/monetarypolicy.htm" },
  ],
};

const out = path.join(__dirname, "..", "public", "mock-snapshot.json");
fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));
console.log("Wrote", out);
console.log("Verdicts:", verdicts.map(v => `${v.days}d:${v.verdict}`).join("  "));
