import { AccountsRepository } from "./repository/accounts.js";
import { RatesRepository } from "./repository/rates.js";
import { LogRepository } from "./repository/log.js";

import { AccountsService } from "./services/accounts.js";
import { RatesService } from "./services/rates.js";
import { LogService } from "./services/log.js";
import { ExchangeService } from "./services/exchange.js";

import { connectRedis } from "./repository/redisClient.js";
import { StatsdClient } from "./metrics/statsd.js";
import { createApp } from "./createApp.js";

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
const exchangeService = new ExchangeService(
  accountsRepository,
  ratesRepository,
  logRepository,
  new StatsdClient()
);

const app = createApp({ accountsService, ratesService, logService, exchangeService });

const port = 3000;

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;
