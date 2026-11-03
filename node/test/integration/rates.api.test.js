import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";

describe("/rates (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("GET / returns the seeded rates", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/rates");

    assert.equal(res.status, 200);
    assert.equal(res.body.USD.ARS, 1513);
  });

  test("PUT / sets a rate and its reciprocal", async () => {
    const { app } = await buildTestApp();

    const res = await request(app)
      .put("/rates")
      .send({ baseCurrency: "USD", counterCurrency: "ARS", rate: 1500 });

    assert.equal(res.status, 200);
    assert.equal(res.body.USD.ARS, 1500);
    assert.equal(res.body.ARS.USD, Number((1 / 1500).toFixed(5)));
  });

  test("PUT / 400s on a non-positive rate", async () => {
    const { app } = await buildTestApp();

    const res = await request(app)
      .put("/rates")
      .send({ baseCurrency: "USD", counterCurrency: "ARS", rate: -1 });

    assert.equal(res.status, 400);
  });

  test("PUT / 400s on a missing field", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).put("/rates").send({ baseCurrency: "USD", rate: 1500 });

    assert.equal(res.status, 400);
  });
});
