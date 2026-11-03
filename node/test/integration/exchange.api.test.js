import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";

describe("POST /exchange (integration, real Redis + HTTP layer)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("200s and moves funds when both legs succeed", async () => {
    const { app, accountsRepository } = await buildTestApp({ transferFn: async () => true });

    const res = await request(app)
      .post("/exchange")
      .send({
        baseCurrency: "ARS",
        counterCurrency: "USD",
        baseAccountId: "client-1",
        counterAccountId: "client-2",
        baseAmount: 1750000,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.counterAmount > 0);

    const usd = await accountsRepository.getAccountByCurrency("USD");
    assert.ok(usd.balance < 60000, "USD balance should have decreased");
  });

  test("500s with a business obs when funds are insufficient, and balances stay untouched", async () => {
    const { app, accountsRepository } = await buildTestApp({ transferFn: async () => true });
    const usdBefore = await accountsRepository.getAccountByCurrency("USD");

    const res = await request(app)
      .post("/exchange")
      .send({
        baseCurrency: "ARS",
        counterCurrency: "USD",
        baseAccountId: "client-1",
        counterAccountId: "client-2",
        baseAmount: 999999999999,
      });

    assert.equal(res.status, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.obs, "Not enough funds on counter currency account");

    const usdAfter = await accountsRepository.getAccountByCurrency("USD");
    assert.equal(usdAfter.balance, usdBefore.balance);
  });

  test("400s on a malformed request (missing required field) before touching any account", async () => {
    const { app, accountsRepository } = await buildTestApp();
    const usdBefore = await accountsRepository.getAccountByCurrency("USD");

    const res = await request(app).post("/exchange").send({
      baseCurrency: "ARS",
      counterCurrency: "USD",
      baseAccountId: "client-1",
      // counterAccountId missing
      baseAmount: 1000,
    });

    assert.equal(res.status, 400);
    const usdAfter = await accountsRepository.getAccountByCurrency("USD");
    assert.equal(usdAfter.balance, usdBefore.balance);
  });

  test("500s and reverses the charge end-to-end when the outflow leg fails", async () => {
    let call = 0;
    const transferFn = async () => {
      call += 1;
      // 1st call = inflow (client -> internal base): ok
      // 2nd call = outflow (internal counter -> client): fails
      // 3rd call = reversal: ok
      return call !== 2;
    };
    const { app, accountsRepository } = await buildTestApp({ transferFn });
    const before = await accountsRepository.getAccounts();

    const res = await request(app)
      .post("/exchange")
      .send({
        baseCurrency: "ARS",
        counterCurrency: "USD",
        baseAccountId: "client-1",
        counterAccountId: "client-2",
        baseAmount: 1750000,
      });

    assert.equal(res.status, 500);
    assert.equal(res.body.obs, "Could not transfer to clients' account");

    // internal balances must end up exactly where they started: the
    // reservation was made and then fully released
    const after = await accountsRepository.getAccounts();
    assert.deepEqual(after, before);
  });

  test("never lets an internal balance go negative under concurrent HTTP overdraft attempts", async () => {
    const { app, accountsRepository } = await buildTestApp({ transferFn: async () => true });

    const attempts = Array.from({ length: 60 }, () =>
      request(app)
        .post("/exchange")
        .send({
          baseCurrency: "ARS",
          counterCurrency: "USD",
          baseAccountId: "client-1",
          counterAccountId: "client-2",
          baseAmount: 1750000, // ~1155 USD each, 60 of these can't all fit in 60000 USD
        })
    );

    const responses = await Promise.all(attempts);
    const ok = responses.filter((r) => r.status === 200).length;
    const rejected = responses.filter((r) => r.status === 500).length;

    assert.equal(ok + rejected, 60);
    assert.ok(ok > 0 && ok < 60, `expected a partial success mix, got ${ok} ok`);

    const usd = await accountsRepository.getAccountByCurrency("USD");
    assert.ok(usd.balance >= 0, `USD balance went negative: ${usd.balance}`);
  });
});
