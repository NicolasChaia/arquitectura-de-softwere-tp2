import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { RatesService } from "../../services/rates.js";
import { InvalidRateError } from "../../exceptions/errors.js";

function fakeRepository(initialRates = {}) {
  const rates = structuredClone(initialRates);
  return {
    rates,
    getRates: () => rates,
    getRate: (base, counter) => rates[base]?.[counter],
    setRate: (base, counter, rate) => {
      rates[base] = rates[base] || {};
      rates[base][counter] = rate;
    },
  };
}

describe("RatesService", () => {
  test("getRates returns whatever the repository has", () => {
    const repository = fakeRepository({ USD: { ARS: 1500 } });
    const service = new RatesService(repository);

    assert.deepEqual(service.getRates(), { USD: { ARS: 1500 } });
  });

  test("setRate stores the given rate and its reciprocal, rounded to 5 decimals", () => {
    const repository = fakeRepository();
    const service = new RatesService(repository);

    service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: 1500 });

    assert.equal(repository.rates.USD.ARS, 1500);
    assert.equal(repository.rates.ARS.USD, Number((1 / 1500).toFixed(5)));
  });

  test("setRate overwrites an existing rate and keeps the reciprocal in sync", () => {
    const repository = fakeRepository({ USD: { ARS: 1000 }, ARS: { USD: 0.001 } });
    const service = new RatesService(repository);

    service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: 1500 });

    assert.equal(repository.rates.USD.ARS, 1500);
    assert.equal(repository.rates.ARS.USD, Number((1 / 1500).toFixed(5)));
  });

  for (const badRate of [0, -10, NaN, Infinity, "1500", null, undefined]) {
    test(`setRate rejects a non-positive/non-finite/non-number rate (${String(badRate)})`, () => {
      const repository = fakeRepository();
      const service = new RatesService(repository);

      assert.throws(
        () => service.setRate({ baseCurrency: "USD", counterCurrency: "ARS", rate: badRate }),
        InvalidRateError
      );
      assert.deepEqual(repository.rates, {});
    });
  }
});
