import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";
import { RedisWindowStore } from "../../middleware/redisWindowStore.js";
import { getRedisClient } from "../../repository/redisClient.js";

const exchangeBody = {
  baseCurrency: "ARS",
  counterCurrency: "USD",
  baseAccountId: "client-1",
  counterAccountId: "client-2",
  baseAmount: 100,
  dni: "40101235",
};

// fixed clock, so a test never straddles two windows
const now = () => 1_800_000_000_000;

function limits(max, store, localMax = 0) {
  return {
    logWindowMs: 60000,
    logMax: 1000,
    exchangeWindowMs: 60000,
    exchangeMax: max,
    exchangeStore: store,
    exchangeLocalMax: localMax,
  };
}

// sends `n` exchanges alternating between the nodes, like the LB would
async function statuses(nodes, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const res = await request(nodes[i % nodes.length].app).post("/exchange").send(exchangeBody);
    out.push(res.status);
  }
  return out;
}

describe("Tactic 2: global rate limit in Redis (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("local (as measured so far): each node has its own limit, so 2 nodes let 2 x max through", async () => {
    const nodes = [
      await buildTestApp({ rateLimits: limits(3) }),
      await buildTestApp({ rateLimits: limits(3) }),
    ];

    const codes = await statuses(nodes, 6);

    assert.equal(codes.filter((c) => c === 429).length, 0);
  });

  test("global: the 2 nodes share one counter, so only max get through in total", async () => {
    const store = () => new RedisWindowStore({ prefix: "ratelimit:exchange:", now });
    const nodes = [
      await buildTestApp({ rateLimits: limits(3, store()) }),
      await buildTestApp({ rateLimits: limits(3, store()) }),
    ];

    const codes = await statuses(nodes, 6);

    assert.deepEqual(codes, [200, 200, 200, 429, 429, 429]);
  });

  test("global: the counter key expires, so old windows do not pile up in Redis", async () => {
    const node = await buildTestApp({
      rateLimits: limits(3, new RedisWindowStore({ prefix: "ratelimit:exchange:", now })),
    });

    await request(node.app).post("/exchange").send(exchangeBody);

    const keys = await getRedisClient().keys("ratelimit:exchange:*");
    assert.equal(keys.length, 1);
    const ttl = await getRedisClient().pTTL(keys[0]);
    assert.ok(ttl > 0 && ttl <= 120000, `pTTL = ${ttl}`);
  });

  test("local backstop: each node lets through at most its local max, and only that reaches Redis", async () => {
    const store = () => new RedisWindowStore({ prefix: "ratelimit:exchange:", now });
    const nodes = [
      await buildTestApp({ rateLimits: limits(3, store(), 2) }),
      await buildTestApp({ rateLimits: limits(3, store(), 2) }),
    ];

    const codes = await statuses(nodes, 8);

    assert.deepEqual(codes, [200, 200, 200, 429, 429, 429, 429, 429]);
    const keys = await getRedisClient().keys("ratelimit:exchange:*");
    assert.equal(Number(await getRedisClient().get(keys[0])), 4);
  });

  test("local backstop: a single node receiving everything stops at its local max, not at the global one", async () => {
    const node = await buildTestApp({
      rateLimits: limits(5, new RedisWindowStore({ prefix: "ratelimit:exchange:", now }), 2),
    });

    const codes = await statuses([node], 5);

    assert.deepEqual(codes, [200, 200, 429, 429, 429]);
  });
});
