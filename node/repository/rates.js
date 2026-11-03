import { getRedisClient, readSeedFile } from "./redisClient.js";

// One hash field per pair: "ARS:USD" -> "0.00066".
const RATES_KEY = "rates:pairs";
const field = (base, counter) => `${base}:${counter}`;

export class RatesRepository {
  async init() {
    const redis = getRedisClient();

    if ((await redis.exists(RATES_KEY)) === 0) {
      console.error(`${RATES_KEY} not found in Redis, seeding from rates.json`);
      const rates = await readSeedFile("rates.json");
      const fields = {};
      for (const [base, counters] of Object.entries(rates)) {
        for (const [counter, rate] of Object.entries(counters)) {
          fields[field(base, counter)] = String(rate);
        }
      }
      // HSETNX semantics per field are not needed: two nodes seeding at the
      // same time write the same values from the same file.
      await redis.hSet(RATES_KEY, fields);
    }
  }

  // nested object: { ARS: { USD: 0.00066, ... }, ... }
  async getRates() {
    const fields = await getRedisClient().hGetAll(RATES_KEY);
    const rates = {};
    for (const [pair, rate] of Object.entries(fields)) {
      const [base, counter] = pair.split(":");
      rates[base] ??= {};
      rates[base][counter] = Number(rate);
    }
    return rates;
  }

  async getRate(baseCurrency, counterCurrency) {
    const rate = await getRedisClient().hGet(RATES_KEY, field(baseCurrency, counterCurrency));
    return rate != null ? Number(rate) : undefined;
  }

  // sets both directions atomically, so no node can read a half-updated pair
  async setRatePair(baseCurrency, counterCurrency, rate, reciprocal) {
    await getRedisClient().hSet(RATES_KEY, {
      [field(baseCurrency, counterCurrency)]: String(rate),
      [field(counterCurrency, baseCurrency)]: String(reciprocal),
    });
  }
}
