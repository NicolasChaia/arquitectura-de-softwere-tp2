import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { AccountsRepository } from "../../repository/accounts.js";

describe("AccountsRepository (integration, real Redis)", () => {
  let repository;

  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
    repository = new AccountsRepository();
    await repository.init(); // seeds from state/accounts.json on an empty db
  });

  after(async () => {
    await teardownRedis();
  });

  test("init seeds the accounts from state/accounts.json when the db is empty", async () => {
    const accounts = await repository.getAccounts();

    const byCurrency = Object.fromEntries(accounts.map((a) => [a.currency, a]));
    assert.equal(byCurrency.ARS.balance, 120000000);
    assert.equal(byCurrency.USD.balance, 60000);
    assert.equal(byCurrency.EUR.balance, 40000);
    assert.equal(byCurrency.BRL.balance, 60000);
  });

  test("init is idempotent: calling it again does not reset balances already changed", async () => {
    await repository.setAccountBalance(2, 999);

    const again = new AccountsRepository();
    await again.init();

    const account = await again.getAccountById(2);
    assert.equal(account.balance, 999);
  });

  test("getAccountByCurrency finds the right account", async () => {
    const account = await repository.getAccountByCurrency("USD");
    assert.equal(account.id, 2);
    assert.equal(account.balance, 60000);
  });

  test("getAccountByCurrency returns null for an unknown currency", async () => {
    const account = await repository.getAccountByCurrency("JPY");
    assert.equal(account, null);
  });

  test("setAccountBalance overwrites the balance in place", async () => {
    await repository.setAccountBalance(1, 42);
    const account = await repository.getAccountById(1);
    assert.equal(account.balance, 42);
  });

  describe("atomicFundsTransfer", () => {
    test("moves funds atomically when the counter account has enough balance", async () => {
      const ars = await repository.getAccountByCurrency("ARS");
      const usd = await repository.getAccountByCurrency("USD");

      const result = await repository.atomicFundsTransfer(ars.id, 1750000, usd.id, 1155);

      assert.equal(result.ok, true);
      assert.equal(result.baseBalance, ars.balance + 1750000);
      assert.equal(result.counterBalance, usd.balance - 1155);

      const usdAfter = await repository.getAccountById(usd.id);
      assert.equal(usdAfter.balance, usd.balance - 1155);
    });

    test("rejects the transfer when the counter account does not have enough balance", async () => {
      const ars = await repository.getAccountByCurrency("ARS");
      const usd = await repository.getAccountByCurrency("USD");

      const result = await repository.atomicFundsTransfer(ars.id, 1, usd.id, usd.balance + 1);

      assert.deepEqual(result, { ok: false, reason: "insufficient_funds" });

      // balances must be untouched
      const usdAfter = await repository.getAccountById(usd.id);
      assert.equal(usdAfter.balance, usd.balance);
    });

    test("reports account_not_found instead of touching balances for an unknown account id", async () => {
      const usd = await repository.getAccountByCurrency("USD");

      const result = await repository.atomicFundsTransfer(999999, 1, usd.id, 1);

      assert.deepEqual(result, { ok: false, reason: "account_not_found" });
    });

    test("never lets the balance go negative under concurrent draining attempts", async () => {
      // USD starts at 60000. Fire many more concurrent transfers than the
      // balance can afford and confirm the script serializes them instead
      // of a check-then-act race letting several through at once.
      const ars = await repository.getAccountByCurrency("ARS");
      const usd = await repository.getAccountByCurrency("USD");
      const costPerTransfer = 1200; // 50 * 1200 = 60000 == exact balance
      const attempts = 80;

      const results = await Promise.all(
        Array.from({ length: attempts }, () =>
          repository.atomicFundsTransfer(ars.id, 1, usd.id, costPerTransfer)
        )
      );

      const succeeded = results.filter((r) => r.ok).length;
      assert.equal(succeeded, Math.floor(usd.balance / costPerTransfer));

      const usdAfter = await repository.getAccountById(usd.id);
      assert.ok(usdAfter.balance >= 0, `balance went negative: ${usdAfter.balance}`);
      assert.equal(usdAfter.balance, usd.balance - succeeded * costPerTransfer);
    });
  });

  describe("atomicAdjustTwo", () => {
    test("applies both deltas atomically", async () => {
      const ars = await repository.getAccountByCurrency("ARS");
      const usd = await repository.getAccountByCurrency("USD");

      const result = await repository.atomicAdjustTwo(ars.id, -1000, usd.id, 500);

      assert.equal(result.ok, true);
      const arsAfter = await repository.getAccountById(ars.id);
      const usdAfter = await repository.getAccountById(usd.id);
      assert.equal(arsAfter.balance, ars.balance - 1000);
      assert.equal(usdAfter.balance, usd.balance + 500);
    });

    test("reports accounts_not_found and applies nothing when an id is invalid", async () => {
      const usd = await repository.getAccountByCurrency("USD");

      const result = await repository.atomicAdjustTwo(999999, -1000, usd.id, 500);

      assert.deepEqual(result, { ok: false, reason: "accounts_not_found" });
      const usdAfter = await repository.getAccountById(usd.id);
      assert.equal(usdAfter.balance, usd.balance);
    });
  });
});
