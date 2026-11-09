import { test, describe } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../../createApp.js";
import { routeTag } from "../../middleware/responseTime.js";

function fakeMetrics() {
  const timings = [];
  return {
    timings,
    timing: (name, ms, tags) => timings.push({ name, ms, tags }),
    count: () => {},
    increment: () => {},
  };
}

function buildApp({ metrics, rateLimits } = {}) {
  return createApp({
    accountsService: { getAccounts: async () => [] },
    ratesService: { getRates: async () => ({}) },
    logService: { getLog: async () => [] },
    exchangeService: { exchange: async () => ({ ok: true }) },
    metrics,
    ...(rateLimits ? { rateLimits } : {}),
  });
}

// the timing is sent on the response's "finish" event, which can land just
// after supertest resolves
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("routeTag", () => {
  test("keeps only the first path segment of known routes", () => {
    assert.equal(routeTag("/"), "/");
    assert.equal(routeTag("/exchange"), "/exchange");
    assert.equal(routeTag("/accounts/1/balance"), "/accounts");
    assert.equal(routeTag("/accounts/999/balance"), "/accounts");
    assert.equal(routeTag("/log"), "/log");
  });

  test("groups unknown paths under 'other' to bound tag cardinality", () => {
    assert.equal(routeTag("/does-not-exist"), "other");
    assert.equal(routeTag("/wp-admin/x"), "other");
  });
});

describe("response time middleware", () => {
  test("sends one http.response_time timing per request with route, method and status tags", async () => {
    const metrics = fakeMetrics();
    const app = buildApp({ metrics });

    await request(app).get("/accounts").expect(200);
    await request(app).put("/accounts/7/balance").send({}).expect(400);
    await settle();

    assert.equal(metrics.timings.length, 2);
    const [get, put] = metrics.timings;
    assert.equal(get.name, "http.response_time");
    assert.ok(get.ms >= 0 && Number.isFinite(get.ms));
    assert.deepEqual(get.tags, ["route:/accounts", "method:GET", "status:200"]);
    assert.deepEqual(put.tags, ["route:/accounts", "method:PUT", "status:400"]);
  });

  test("also times requests rejected by the rate limiter (429)", async () => {
    const metrics = fakeMetrics();
    const app = buildApp({
      metrics,
      rateLimits: { logWindowMs: 60000, logMax: 1, exchangeWindowMs: 60000, exchangeMax: 1 },
    });

    await request(app).get("/log").expect(200);
    await request(app).get("/log").expect(429);
    await settle();

    assert.deepEqual(
      metrics.timings.map((t) => t.tags[2]),
      ["status:200", "status:429"]
    );
  });

  test("is not mounted when no metrics client is given", async () => {
    const app = buildApp();
    await request(app).get("/").expect(200);
  });
});
