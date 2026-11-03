import { AccountsRepository } from "../../../repository/accounts.js";
import { RatesRepository } from "../../../repository/rates.js";
import { LogRepository } from "../../../repository/log.js";

import { AccountsService } from "../../../services/accounts.js";
import { RatesService } from "../../../services/rates.js";
import { LogService } from "../../../services/log.js";
import { ExchangeService } from "../../../services/exchange.js";

import { createApp } from "../../../createApp.js";

// Wires the real services to the real (test) Redis via the real repositories,
// exactly like app.js does - the only difference is `transferFn`, which
// tests control instead of leaving to the random 200-400ms stub, and
// `rateLimits`, which tests can tighten to exercise 429s without waiting a
// full second per test.
export async function buildTestApp({ transferFn, rateLimits } = {}) {
  const accountsRepository = new AccountsRepository();
  const ratesRepository = new RatesRepository();
  const logRepository = new LogRepository();

  await accountsRepository.init();
  await ratesRepository.init();
  await logRepository.init();

  const accountsService = new AccountsService(accountsRepository);
  const ratesService = new RatesService(ratesRepository);
  const logService = new LogService(logRepository);
  const exchangeService = new ExchangeService(
    accountsRepository,
    ratesRepository,
    logRepository,
    undefined,
    transferFn ?? (async () => true)
  );

  const app = createApp({
    accountsService,
    ratesService,
    logService,
    exchangeService,
    ...(rateLimits ? { rateLimits } : {}),
  });

  return { app, accountsRepository, ratesRepository, logRepository };
}
