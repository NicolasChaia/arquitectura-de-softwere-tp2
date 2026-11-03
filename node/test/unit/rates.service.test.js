import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { RatesService } from "../../services/rates.js";
import { InvalidRateError } from "../../exceptions/errors.js";

function fakeRepository(initialRates = {}) {
  const rates = structuredClone(initialRates);
  const set = (base, counter, rate) => {
    rates[base] = rates[base] || {};
    rates[base][counter] = rate;
  };
  return {
    rates,
    getRates: async () => rates,
    getRate: async (base, counter) => rates[base]?.[counter],
    setRatePair: async (base, counter, rate, reciprocal) => {
      set(base, counter, rate);
      set(counter, base, reciprocal);
    },
  };
}

describe("RatesService", () => {
  test("getRates returns whatever the repository has", async () => {
    const service = new RatesService(fakeRepository({ USD: { ARS: 1500 } }));

    assert.deepEqual(await service.getRates(), { USD: { ARS: 1500 } });
  });

  test("setRate stores the given rate and its reciprocal, rounded to 5 decimals", async () => {
    const repository = fakeRepository();
    const service = new RatesService(repository);

    await service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: 1500 });

    assert.equal(repository.rates.USD.ARS, 1500);
    assert.equal(repository.rates.ARS.USD, Number((1 / 1500).toFixed(5)));
  });

  test("setRate overwrites an existing rate and keeps the reciprocal in sync", async () => {
    const repository = fakeRepository({ USD: { ARS: 1000 }, ARS: { USD: 0.001 } });
    const service = new RatesService(repository);

    await service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: 1500 });

    assert.equal(repository.rates.USD.ARS, 1500);
    assert.equal(repository.rates.ARS.USD, Number((1 / 1500).toFixed(5)));
  });

  for (const badRate of [0, -10, NaN, Infinity, "1500", null, undefined]) {
    test(`setRate rejects a non-positive/non-finite/non-number rate (${String(badRate)})`, async () => {
      const repository = fakeRepository();
      const service = new RatesService(repository);

      await assert.rejects(
        service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: badRate }),
        InvalidRateError
      );
      assert.deepEqual(repository.rates, {});
    });
  }
});
