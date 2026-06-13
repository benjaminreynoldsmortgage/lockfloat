// ============================================================
// datasources.js — all external fetches live here.
// FRED (free) for the hard economic series, NewsAPI (free tier) for headlines,
// Anthropic for the desk narrative + the two judgment factors (spread/cal/news).
// ============================================================

const FRED = "https://api.stlouisfed.org/fred/series/observations";

// Pull a FRED series as an array of {date, value}, newest last. Drops blanks.
async function fred(seriesId, key, days = 120) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const fmt = d => d.toISOString().slice(0, 10);
  const url = `${FRED}?series_id=${seriesId}&api_key=${key}&file_type=json` +
              `&observation_start=${fmt(start)}&observation_end=${fmt(end)}&sort_order=asc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${seriesId} ${r.status}`);
  const j = await r.json();
  return (j.observations || [])
    .filter(o => o.value !== "." && o.value !== "")
    .map(o => ({ date: o.date, value: +o.value }));
}

// Convenience: just the numeric values.
const vals = arr => arr.map(o => o.value);

// Latest YoY % for a monthly index series (e.g. CPI, PPI).
function latestYoY(series) {
  if (series.length < 13) return null;
  const n = series.length;
  // find value ~12 obs back (monthly)
  const cur = series[n - 1].value;
  const prior = series[n - 13].value;
  return +(((cur - prior) / prior) * 100).toFixed(2);
}
function prevYoY(series) {
  if (series.length < 14) return null;
  const n = series.length;
  return +(((series[n - 2].value - series[n - 14].value) / series[n - 14].value) * 100).toFixed(2);
}

// ---- pull everything from FRED in parallel ----
async function pullEconomic(fredKey) {
  const [tenY, fedFunds, cpi, ppi, wti, mortgage30] = await Promise.all([
    fred("DGS10", fredKey, 120),          // 10Y Treasury, daily
    fred("DFF",   fredKey, 30),           // Fed funds effective, daily
    fred("CPIAUCSL", fredKey, 500),       // CPI, monthly
    fred("PPIACO",   fredKey, 500),       // PPI all commodities, monthly
    fred("DCOILWTICO", fredKey, 60),      // WTI crude, daily
    fred("MORTGAGE30US", fredKey, 60),    // Freddie 30Y avg, weekly (real mortgage anchor)
  ]);
  const tenSeries = vals(tenY);
  const mortgageSeries = vals(mortgage30);
  // real current-coupon-ish spread = latest Freddie 30Y minus latest 10Y
  const lastTen = tenSeries[tenSeries.length - 1];
  const lastMtg = mortgageSeries[mortgageSeries.length - 1];
  const spread = lastMtg && lastTen ? +(lastMtg - lastTen).toFixed(2) : 2.7;

  return {
    tenY: tenSeries,
    tenYLatest: lastTen,
    fedFunds: vals(fedFunds).slice(-1)[0],
    cpiYoY: latestYoY(cpi),
    cpiPrevYoY: prevYoY(cpi),
    ppiYoY: latestYoY(ppi),
    wti: vals(wti),
    mortgage30: lastMtg,
    spread,
  };
}

// ---- news headlines (NewsAPI free tier) ----
async function pullNews(newsKey) {
  if (!newsKey) return [];
  const q = encodeURIComponent('(Federal Reserve OR inflation OR Treasury OR "mortgage rates" OR FOMC OR jobs report)');
  const url = `https://newsapi.org/v2/everything?q=${q}&language=en&sortBy=publishedAt&pageSize=12&apiKey=${newsKey}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    return (j.articles || []).map(a => ({ title: a.title, source: a.source?.name, at: a.publishedAt, url: a.url }));
  } catch { return []; }
}

// ---- Anthropic: judgment factors + desk narrative, grounded in the numbers we pass ----
// We give Claude the hard numbers + headlines and ask ONLY for: a -1..+1 Fed bias flag,
// a -1..+1 headline-volatility overlay, the news/cal/spread judgment scores, and prose.
// It does NOT invent the rate numbers; those come from FRED.
async function aiNarrative(anthropicKey, snapshotNumbers, headlines) {
  const sys = `You are a mortgage secondary-marketing desk analyst at Cook Inlet Lending Center (Anchorage, AK).
You are given HARD numeric readings (already fetched) and recent headlines. Do not invent or override the numbers.
Return ONLY valid JSON, no markdown:
{
 "fedBias": <number -1..1, + = hawkish/hike-leaning>,
 "headlineRisk": <number -1..1, + = high near-term volatility risk>,
 "scoreSpread": <int -2..2, + favors lock>,
 "scoreCal": <int -2..2, + = heavy upcoming data-calendar risk favoring lock>,
 "scoreNews": <int -2..2, + = headlines lean rates up / favor lock>,
 "headline": "<3-4 sentence desk read tying the numbers + news together, plain language for loan officers>",
 "alaska": "<1-2 sentences on any Alaska/oil angle relevant to local borrowers, or '' if none>"
}`;
  const user = `HARD READINGS:\n${JSON.stringify(snapshotNumbers, null, 1)}\n\nHEADLINES:\n` +
    headlines.map(h => `- ${h.title} (${h.source})`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 900,
      system: sys, messages: [{ role: "user", content: user }],
    }),
  });
  const j = await r.json();
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(a, b + 1));
}

module.exports = { pullEconomic, pullNews, aiNarrative };
