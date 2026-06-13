// ============================================================
// api/update.js — the scheduled brain. Vercel Cron hits this every 30-60 min.
// Pulls data -> scores factors -> forecasts -> AI narrative -> stores ONE snapshot.
// The dashboard never computes; it just reads the snapshot this writes.
// ============================================================
const eng = require("../lib/engine");
const ds  = require("../lib/datasources");
const { redis } = require("../lib/store"); // Upstash Redis store

module.exports = async (req, res) => {
  // simple shared-secret guard so only the cron (or you) can trigger a refresh
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.key !== secret && req.headers["authorization"] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const fredKey = process.env.FRED_API_KEY;
    const newsKey = process.env.NEWSAPI_KEY;
    const aiKey   = process.env.ANTHROPIC_API_KEY;

    // 1) hard numbers from FRED
    const econ = await ds.pullEconomic(fredKey);
    // 2) headlines
    const headlines = await ds.pullNews(newsKey);

    // 3) AI judgment overlay + narrative (grounded in the numbers, doesn't invent them)
    //    OPTIONAL: if no ANTHROPIC_API_KEY is set, we skip it and use data-driven
    //    fallbacks below so every factor still gets a real, defensible score.
    let ai = null;
    if (aiKey) {
      try {
        ai = await ds.aiNarrative(aiKey, {
          tenYearLatest: econ.tenYLatest, fedFunds: econ.fedFunds,
          cpiYoY: econ.cpiYoY, cpiPrevYoY: econ.cpiPrevYoY, ppiYoY: econ.ppiYoY,
          mortgage30: econ.mortgage30, spread: econ.spread,
          wtiLatest: econ.wti.slice(-1)[0],
        }, headlines);
      } catch (e) { ai = null; }
    }

    // --- fallbacks when AI is off: derive the soft factors from the hard data ---
    // Fed bias: restrictive (funds well above ~3% neutral) leans hawkish/lock.
    const fedBiasFb = econ.fedFunds != null ? Math.max(-1, Math.min(1, (econ.fedFunds - 3.0) * 0.6)) : 0;
    const headlineRiskFb = 0;
    // Spread judgment: wide spread vs the ~2.5 historical norm slightly favors lock (note rates lag).
    const spreadFb = econ.spread != null ? eng.clampScore((econ.spread - 2.5) * 2) : 0;
    const calFb = 0; // without a news/AI read we can't see the calendar; stay neutral.
    // News lean: rough tilt from how many inflation/Fed stories are live.
    const newsFb = eng.clampScore(Math.min(2, Math.floor((headlines.length || 0) / 5)));

    const fedBias      = ai ? ai.fedBias      : fedBiasFb;
    const headlineRisk = ai ? ai.headlineRisk : headlineRiskFb;
    const scoreSpread  = ai ? ai.scoreSpread  : spreadFb;
    const scoreCal     = ai ? ai.scoreCal     : calFb;
    const scoreNews    = ai ? ai.scoreNews    : newsFb;
    const headlineText = ai && ai.headline ? ai.headline
      : `Live readings below (FRED + news). 10Y ${econ.tenYLatest?.toFixed(2)}%, Fed funds ${econ.fedFunds?.toFixed(2)}%, CPI ${econ.cpiYoY}% YoY, PPI ${econ.ppiYoY}% YoY. Narrative layer is off (no AI key) — verdicts are driven by the hard data and the factor scoreboard.`;
    const alaskaText   = ai ? (ai.alaska || "") : "";

    // 4) score every factor from the hard series + (AI or fallback) overlays
    const factors = [
      { key: "trend",  score: eng.scoreTrend(econ.tenY),                        val: `${econ.tenYLatest?.toFixed(2)}%` },
      { key: "momo",   score: eng.scoreMomentum(econ.tenY),                     val: momoLabel(econ.tenY) },
      { key: "vol",    score: eng.scoreVol(econ.tenY, headlineRisk),            val: headlineRisk > 0.3 ? "Elevated" : "Normal" },
      { key: "spread", score: eng.clampScore(scoreSpread),                      val: `${econ.spread} pts` },
      { key: "fed",    score: eng.scoreFed(econ.fedFunds, fedBias),            val: `${econ.fedFunds?.toFixed(2)}%` },
      { key: "infl",   score: eng.scoreInflation(econ.cpiYoY, econ.ppiYoY, econ.cpiPrevYoY), val: `CPI ${econ.cpiYoY}% · PPI ${econ.ppiYoY}%` },
      { key: "oil",    score: eng.scoreOil(econ.wti),                           val: oilLabel(econ.wti) },
      { key: "cal",    score: eng.clampScore(scoreCal),                         val: scoreCal >= 1 ? "Heavy" : "Light" },
      { key: "news",   score: eng.clampScore(scoreNews),                        val: `${headlines.length} stories` },
    ].map(f => ({ ...f, nm: eng.FACTOR_META[f.key].nm, sub: eng.FACTOR_META[f.key].sub }));

    // 5) verdicts per window + statistical forecast
    const verdicts = eng.WINDOWS.map(d => eng.scoreWindow(d, factors));
    const forecast = eng.forecastRates(econ.tenY, econ.spread);

    // 6) assemble the snapshot the dashboard reads
    const snapshot = {
      asOf: new Date().toISOString(),
      asOfLabel: new Date().toLocaleString("en-US", { timeZone: "America/Anchorage" }) + " AKT",
      headline: headlineText,
      alaska: alaskaText,
      factors, verdicts, forecast,
      readings: {
        tenYear: econ.tenYLatest, fedFunds: econ.fedFunds, mortgage30: econ.mortgage30,
        cpiYoY: econ.cpiYoY, ppiYoY: econ.ppiYoY, spread: econ.spread,
        wti: econ.wti.slice(-1)[0],
      },
      // trailing series for the dashboard sparkline / history view
      history: { tenY: econ.tenY.slice(-60) },
      headlines: headlines.slice(0, 8),
    };

    await redis.set("lockfloat:snapshot", snapshot);
    await redis.lpush("lockfloat:archive", JSON.stringify({ at: snapshot.asOf, verdicts: snapshot.verdicts.map(v => ({ d: v.days, v: v.verdict })) }));
    await redis.ltrim("lockfloat:archive", 0, 500); // keep last 500 runs for history

    res.status(200).json({ ok: true, asOf: snapshot.asOf, verdicts: snapshot.verdicts });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

function momoLabel(s) {
  if (!s || s.length < 6) return "—";
  const bp = ((s[s.length - 1] - s[s.length - 6]) * 100 / 5).toFixed(1);
  return `${bp >= 0 ? "+" : ""}${bp} bp/day`;
}
function oilLabel(s) {
  if (!s || s.length < 11) return "—";
  const pct = ((s[s.length - 1] - s[s.length - 11]) / s[s.length - 11] * 100).toFixed(1);
  return `WTI ${pct >= 0 ? "+" : ""}${pct}% / 10d`;
}
