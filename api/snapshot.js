// ============================================================
// api/snapshot.js — what the dashboard polls. Returns the last computed snapshot.
// Cheap & fast: no external calls, just reads the stored result.
// ============================================================
const { redis } = require("../lib/store");

module.exports = async (req, res) => {
  try {
    const snap = await redis.get("lockfloat:snapshot");
    res.setHeader("Cache-Control", "public, max-age=60"); // browsers/CDN cache 60s
    if (!snap) return res.status(503).json({ error: "warming up — no snapshot yet. Trigger /api/update." });
    res.status(200).json(snap);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
