import { rateLimit } from "express-rate-limit";

// Without `store`: counts in this process' memory, per client IP (the
// express-rate-limit default), so with N nodes the limit is N x max per IP.
// With a shared `store` (RedisWindowStore): a single key for every request,
// so `max` is the limit of the whole system (tactic 2, perf/predicciones.md P7).
// If the store fails (Redis down) the request goes through (fail open).
export function createRateLimiter({ windowMs, max, store }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store, keyGenerator: () => "global", passOnStoreError: true } : {}),
    handler: (req, res) => {
      res.status(429).json({ error: "Too many requests, try again shortly" });
    },
  });
}
