import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";

describe("/log (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("GET / returns the exchange log, most recent entries kept on top of DEFAULT_LOG_LIMIT", async () => {
    const { app } = await buildTestApp({ transferFn: async () => true });

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/exchange")
        .send({
          baseCurrency: "ARS",
          counterCurrency: "USD",
          baseAccountId: "client-1",
          counterAccountId: "client-2",
          baseAmount: 100,
        });
    }

    const res = await request(app).get("/log");

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
  });

  test("GET / respects a custom, valid limit", async () => {
    const { app } = await buildTestApp({ transferFn: async () => true });

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/exchange")
        .send({
          baseCurrency: "ARS",
          counterCurrency: "USD",
          baseAccountId: "client-1",
          counterAccountId: "client-2",
          baseAmount: 100,
        });
    }

    const res = await request(app).get("/log?limit=2");

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });

  test("GET / 400s on a non-integer limit", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/log?limit=abc");

    assert.equal(res.status, 400);
  });

  test("GET / 400s on a limit above MAX_LOG_LIMIT", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/log?limit=10000");

    assert.equal(res.status, 400);
  });
});
