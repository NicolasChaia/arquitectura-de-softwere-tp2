import { rateLimit } from "express-rate-limit";

export function createRateLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: "Too many requests, try again shortly" });
    },
  });
}
