import { loadOrSeed, scheduleSnapshot } from "./redisClient.js";

export class RatesRepository {
  constructor() {
    this.rates = null;
  }

  async init() {
    this.rates = await loadOrSeed("rates", "rates.json");
    scheduleSnapshot("rates", () => this.rates, 5000);
  }

  getRates() {
    return this.rates;
  }

  getRate(baseCurrency, counterCurrency) {
    return this.rates[baseCurrency]?.[counterCurrency];
  }

  setRate(baseCurrency, counterCurrency, rate) {
    this.rates[baseCurrency][counterCurrency] = rate;
  }
}
