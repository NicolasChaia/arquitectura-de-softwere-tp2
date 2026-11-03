import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";

describe("/accounts (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("GET / returns the seeded accounts", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/accounts");

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 4);
    assert.ok(res.body.some((a) => a.currency === "USD" && a.balance === 60000));
  });

  test("PUT /:id/balance updates the balance and returns the full list", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).put("/accounts/2/balance").send({ balance: 12345 });

    assert.equal(res.status, 200);
    const usd = res.body.find((a) => a.id === 2);
    assert.equal(usd.balance, 12345);
  });

  test("PUT /:id/balance 400s when balance is missing", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).put("/accounts/2/balance").send({});

    assert.equal(res.status, 400);
  });

  test("PUT /:id/balance 400s when balance is 0 (falsy, hits the same guard as missing)", async () => {
    // Documents current behavior: the route guard is `!balance`, so a
    // legitimate zero balance is rejected the same as a missing field
    // (api/accounts.js). Worth knowing if a real "zero out this account"
    // use case ever comes up.
    const { app } = await buildTestApp();

    const res = await request(app).put("/accounts/2/balance").send({ balance: 0 });

    assert.equal(res.status, 400);
  });
});
