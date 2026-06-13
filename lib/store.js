// ============================================================
// store.js — one place that connects to the Redis store (Upstash).
// Auto-detects whichever env var names Vercel/Upstash created, so you
// don't have to rename anything in the dashboard.
// ============================================================
const { Redis } = require("@upstash/redis");

// Upstash's integration may name the vars in a few ways. Accept all of them.
const url =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_URL;
const token =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = new Redis({ url, token });

module.exports = { redis };
