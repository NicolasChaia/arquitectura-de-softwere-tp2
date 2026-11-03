import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ExchangeService } from "../../services/exchange.js";

const BASE_ACCOUNT = { id: 1, currency: "ARS", balance: 1000000 };
const COUNTER_ACCOUNT = { id: 2, currency: "USD", balance: 60000 };

function fakeAccountsRepository({ reservation = { ok: true } } = {}) {
  const calls = [];
  return {
    calls,
    getAccountByCurrency: async (currency) => {
      calls.push(["getAccountByCurrency", currency]);
      return currency === "ARS" ? BASE_ACCOUNT : COUNTER_ACCOUNT;
    },
    atomicFundsTransfer: async (baseId, baseAmount, counterId, counterAmount) => {
      calls.push(["atomicFundsTransfer", baseId, baseAmount, counterId, counterAmount]);
      return reservation;
    },
    atomicAdjustTwo: async (id1, delta1, id2, delta2) => {
      calls.push(["atomicAdjustTwo", id1, delta1, id2, delta2]);
      return { ok: true };
    },
  };
}

function fakeRatesRepository(rate = 0.00066) {
  return { getRate: () => rate };
}

function fakeLogRepository() {
  const entries = [];
  return { entries, addLog: (entry) => entries.push(entry) };
}

function fakeMetrics() {
  const calls = [];
  return { calls, count: (name, value) => calls.push([name, value]) };
}

// resolves calls to `transfer` in the given order/outcome; throws if called
// more times than scripted
function scriptedTransfer(outcomes) {
  let i = 0;
  const calls = [];
  const fn = async (from, to, amount) => {
    calls.push([from, to, amount]);
    if (i >= outcomes.length) {
      throw new Error("transfer called more times than scripted");
    }
    return outcomes[i++];
  };
  fn.calls = calls;
  return fn;
}

const request = {
  baseCurrency: "ARS",
  counterCurrency: "USD",
  baseAccountId: "client-1",
  counterAccountId: "client-2",
  baseAmount: 1750000,
};

describe("ExchangeService - both legs succeed", () => {
  test("marks the exchange ok, computes counterAmount, and records volume/net metrics", async () => {
    const accountsRepository = fakeAccountsRepository();
    const logRepository = fakeLogRepository();
    const metrics = fakeMetrics();
    const transfer = scriptedTransfer([true, true]);
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(0.00066),
      logRepository,
      metrics,
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, true);
    assert.equal(result.counterAmount, 1750000 * 0.00066);
    assert.equal(result.obs, null);

    // both transfers launched, client base -> internal base, internal counter -> client counter
    assert.deepEqual(transfer.calls, [
      ["client-1", BASE_ACCOUNT.id, 1750000],
      [COUNTER_ACCOUNT.id, "client-2", 1750000 * 0.00066],
    ]);

    // reservation was attempted, and never rolled back
    assert.equal(accountsRepository.calls.filter((c) => c[0] === "atomicAdjustTwo").length, 0);

    assert.deepEqual(metrics.calls, [
      ["volume.ARS", 1750000],
      ["volume.USD", 1750000 * 0.00066],
      ["net.ARS", 1750000],
      ["net.USD", -(1750000 * 0.00066)],
    ]);

    assert.equal(logRepository.entries.length, 1);
    assert.equal(logRepository.entries[0].ok, true);
  });

  test("does not throw and skips metrics when no metrics client was injected", async () => {
    const service = new ExchangeService(
      fakeAccountsRepository(),
      fakeRatesRepository(),
      fakeLogRepository(),
      undefined,
      scriptedTransfer([true, true])
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, true);
  });
});

describe("ExchangeService - reservation fails", () => {
  test("insufficient_funds: sets a business-readable obs, never calls transfer", async () => {
    const accountsRepository = fakeAccountsRepository({
      reservation: { ok: false, reason: "insufficient_funds" },
    });
    const logRepository = fakeLogRepository();
    const transfer = scriptedTransfer([]);
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(),
      logRepository,
      fakeMetrics(),
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, "Not enough funds on counter currency account");
    assert.deepEqual(transfer.calls, []);
    assert.equal(logRepository.entries[0].ok, false);
  });

  // Documents current behavior, not necessarily desired behavior: exchangeResult.obs
  // is only populated for reason === "insufficient_funds" (services/exchange.js:48).
  // Any other rejection reason (e.g. "account_not_found") is silently swallowed and
  // the caller gets back ok:false with obs:null - no explanation of what went wrong.
  test("a rejection reason other than insufficient_funds leaves obs as null", async () => {
    const accountsRepository = fakeAccountsRepository({
      reservation: { ok: false, reason: "account_not_found" },
    });
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(),
      fakeLogRepository(),
      fakeMetrics(),
      scriptedTransfer([])
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, null);
  });
});

describe("ExchangeService - partial transfer failure (reconciliation branches)", () => {
  test("inflow ok, outflow fails: reverses the charge and releases the reservation", async () => {
    const accountsRepository = fakeAccountsRepository();
    const logRepository = fakeLogRepository();
    const transfer = scriptedTransfer([true, false, true]); // inflow ok, outflow fail, reversal
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(0.00066),
      logRepository,
      fakeMetrics(),
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, "Could not transfer to clients' account");

    // third call is the reversal: money goes back from the internal base
    // account to the client that was charged
    assert.deepEqual(transfer.calls[2], [BASE_ACCOUNT.id, "client-1", 1750000]);

    const adjust = accountsRepository.calls.find((c) => c[0] === "atomicAdjustTwo");
    assert.deepEqual(adjust, [
      "atomicAdjustTwo",
      BASE_ACCOUNT.id,
      -1750000,
      COUNTER_ACCOUNT.id,
      1750000 * 0.00066,
    ]);
  });

  test("inflow fails, outflow ok: recovers the payout and releases the reservation", async () => {
    const accountsRepository = fakeAccountsRepository();
    const logRepository = fakeLogRepository();
    const transfer = scriptedTransfer([false, true, true]); // inflow fail, outflow ok, recovery
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(0.00066),
      logRepository,
      fakeMetrics(),
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, "Could not withdraw from clients' account");

    // third call is the recovery: money comes back from the client that
    // was paid without having been charged
    assert.deepEqual(transfer.calls[2], ["client-2", COUNTER_ACCOUNT.id, 1750000 * 0.00066]);

    const adjust = accountsRepository.calls.find((c) => c[0] === "atomicAdjustTwo");
    assert.ok(adjust, "expected the reservation to be released");
  });

  test("neither leg succeeds: only releases the reservation, no extra transfer", async () => {
    const accountsRepository = fakeAccountsRepository();
    const transfer = scriptedTransfer([false, false]);
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(0.00066),
      fakeLogRepository(),
      fakeMetrics(),
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, "Could not withdraw from clients' account");
    assert.equal(transfer.calls.length, 2); // no third, reconciling transfer
    assert.ok(accountsRepository.calls.some((c) => c[0] === "atomicAdjustTwo"));
  });

  test("a rejected transfer promise counts as a failed leg, same as resolving false", async () => {
    const accountsRepository = fakeAccountsRepository();
    let i = 0;
    const transfer = async () => {
      i += 1;
      if (i === 1) return true; // inflow ok
      if (i === 2) throw new Error("network blip"); // outflow rejects
      return true; // reversal
    };
    const service = new ExchangeService(
      accountsRepository,
      fakeRatesRepository(0.00066),
      fakeLogRepository(),
      fakeMetrics(),
      transfer
    );

    const result = await service.exchange(request);

    assert.equal(result.ok, false);
    assert.equal(result.obs, "Could not transfer to clients' account");
  });
});
