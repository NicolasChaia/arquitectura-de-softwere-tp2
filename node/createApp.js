import express from "express";

import { createAccountsRouter } from "./api/accounts.js";
import { createRatesRouter } from "./api/rates.js";
import { createLogRouter } from "./api/log.js";
import { createExchangeRouter } from "./api/exchange.js";
import { createHealthRouter } from "./api/health.js";

import { DomainError } from "./exceptions/errors.js";
import { createRateLimiter } from "./middleware/rateLimit.js";

// Builds the Express app from already-constructed services, with no I/O
// side effects (no Redis connection, no listen()). This is what lets tests
// exercise the HTTP layer directly: unit tests pass fake services, and
// integration tests pass services wired to a real (test) Redis instance.
export function createApp({
  accountsService,
  ratesService,
  logService,
  exchangeService,
  rateLimits = { logWindowMs: 1000, logMax: 300, exchangeWindowMs: 1000, exchangeMax: 500 },
}) {
  const app = express();

  app.use(express.json());

  const logLimiter = createRateLimiter({
    windowMs: rateLimits.logWindowMs,
    max: rateLimits.logMax,
  });
  const exchangeLimiter = createRateLimiter({
    windowMs: rateLimits.exchangeWindowMs,
    max: rateLimits.exchangeMax,
  });

  app.use("/health", createHealthRouter());
  app.use("/accounts", createAccountsRouter(accountsService));
  app.use("/rates", createRatesRouter(ratesService));
  app.use("/log", logLimiter, createLogRouter(logService));
  app.use("/exchange", exchangeLimiter, createExchangeRouter(exchangeService));

  app.use((err, req, res, next) => {
    if (err instanceof DomainError) {
      return res.status(err.status).json({ error: err.message });
    }

    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON body" });
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
