import { AccountsRepository } from "./repository/accounts.js";
import { RatesRepository } from "./repository/rates.js";
import { LogRepository } from "./repository/log.js";

import { AccountsService } from "./services/accounts.js";
import { RatesService } from "./services/rates.js";
import { LogService } from "./services/log.js";
import { ExchangeService } from "./services/exchange.js";

import { connectRedis } from "./repository/redisClient.js";
import { StatsdClient } from "./metrics/statsd.js";
import { startRuntimeMetrics } from "./metrics/runtime.js";
import { ArcaClient } from "./external/arca.js";
import { RedisWindowStore } from "./middleware/redisWindowStore.js";
import { createApp } from "./createApp.js";
import config from "./config.js";

await connectRedis();

// single shared instance per resource, so every service/route
// reads and writes the same in-memory state
const accountsRepository = new AccountsRepository();
const ratesRepository = new RatesRepository();
const logRepository = new LogRepository();

await accountsRepository.init();
await ratesRepository.init();
await logRepository.init();

const accountsService = new AccountsService(accountsRepository);
const ratesService = new RatesService(ratesRepository);
const logService = new LogService(logRepository);

const metrics = new StatsdClient();
startRuntimeMetrics(metrics);
const arcaClient = new ArcaClient({
  baseUri: config.arcaUri,
  timeoutMs: config.arcaTimeoutMs,
  retries: config.arcaRetries,
  metrics,
});

const exchangeService = new ExchangeService(
  accountsRepository,
  ratesRepository,
  logRepository,
  metrics,
  undefined,
  arcaClient
);

const rateLimits = {
  logWindowMs: 1000,
  logMax: 300,
  exchangeWindowMs: 1000,
  exchangeMax: config.exchangeRateLimit,
  exchangeLocalMax: config.exchangeLocalRateLimit,
  exchangeStore:
    config.rateLimitMode === "global" ? new RedisWindowStore({ prefix: "ratelimit:exchange:" }) : undefined,
};

const app = createApp({ accountsService, ratesService, logService, exchangeService, metrics, rateLimits });

const port = 3000;

app.listen(port, () => {
  console.log(
    `Exchange API listening on port ${port} (ARCA retries: ${config.arcaRetries}, ` +
      `exchange rate limit: ${config.exchangeRateLimit} req/s ${config.rateLimitMode}` +
      (config.rateLimitMode === "global" && config.exchangeLocalRateLimit > 0
        ? `, local backstop: ${config.exchangeLocalRateLimit} req/s per node)`
        : ")")
  );
});

export default app;
