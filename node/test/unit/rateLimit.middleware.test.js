import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { createRateLimiter } from "../../middleware/rateLimit.js";
import { RedisWindowStore } from "../../middleware/redisWindowStore.js";
import { createApp } from "../../createApp.js";

function appWith(limiter) {
  const app = express();
  app.get("/", limiter, (req, res) => res.send("ok"));
  return app;
}

describe("rate limiter with a shared store (tactic 2)", () => {
  test("fail open: if the store fails (Redis down) the request goes through", async () => {
    const brokenStore = {
      localKeys: false,
      init() {},
      increment: async () => {
        throw new Error("Redis down");
      },
      decrement: async () => {},
      resetKey: async () => {},
    };
    const app = appWith(createRateLimiter({ windowMs: 1000, max: 1, store: brokenStore }));

    await request(app).get("/").expect(200);
    await request(app).get("/").expect(200);
  });

  test("all requests count against one key, whatever the client", async () => {
    const seen = [];
    const store = {
      localKeys: false,
      init() {},
      increment: async (key) => {
        seen.push(key);
        return { totalHits: seen.length, resetTime: new Date(Date.now() + 1000) };
      },
      decrement: async () => {},
      resetKey: async () => {},
    };
    const app = appWith(createRateLimiter({ windowMs: 1000, max: 10, store }));

    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1");
    await request(app).get("/").set("X-Forwarded-For", "2.2.2.2");

    assert.equal(new Set(seen).size, 1);
  });

  test("RedisWindowStore: same window -> same key; next window -> new key", async () => {
    let t = 10_500;
    const calls = [];
    const fakeRedis = {
      eval: async (script, { keys }) => {
        calls.push(keys[0]);
        return calls.filter((k) => k === keys[0]).length;
      },
    };
    const store = new RedisWindowStore({ prefix: "rl:", getClient: () => fakeRedis, now: () => t });
    store.init({ windowMs: 1000 });

    const a = await store.increment("global");
    t = 10_999;
    const b = await store.increment("global");
    t = 11_000;
    const c = await store.increment("global");

    assert.deepEqual(calls, ["rl:global:10", "rl:global:10", "rl:global:11"]);
    assert.deepEqual([a.totalHits, b.totalHits, c.totalHits], [1, 2, 1]);
    assert.equal(a.resetTime.getTime(), 11_000);
  });
});

// --- Tactic 2, second iteration: local backstop in front of the global limit ---

const exchangeBody = {
  baseCurrency: "ARS",
  counterCurrency: "USD",
  baseAccountId: "client-1",
  counterAccountId: "client-2",
  baseAmount: 100,
  dni: "40101235",
};

// stand-in for RedisWindowStore: counts in memory and records every call,
// so a test can tell which requests reached "Redis"
function countingStore() {
  const store = {
    calls: 0,
    hits: 0,
    localKeys: false,
    init() {},
    increment: async () => {
      store.calls++;
      store.hits++;
      return { totalHits: store.hits, resetTime: new Date(Date.now() + 60000) };
    },
    decrement: async () => {},
    resetKey: async () => {},
  };
  return store;
}

function exchangeApp({ exchangeMax, exchangeLocalMax, exchangeStore }) {
  return createApp({
    accountsService: { getAccounts: async () => [] },
    ratesService: { getRates: async () => ({}) },
    logService: { getLog: async () => [] },
    exchangeService: { exchange: async () => ({ ok: true }) },
    rateLimits: { logWindowMs: 60000, logMax: 1000, exchangeWindowMs: 60000, exchangeMax, exchangeLocalMax, exchangeStore },
  });
}

async function send(app, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((await request(app).post("/exchange").send(exchangeBody)).status);
  return out;
}

const rejected = (codes) => codes.filter((c) => c === 429).length;

describe("local backstop in front of the global limit (tactic 2, second iteration)", () => {
  test("what the local backstop rejects never reaches the shared store (Redis)", async () => {
    const store = countingStore();
    const app = exchangeApp({ exchangeMax: 10, exchangeLocalMax: 2, exchangeStore: store });

    const codes = await send(app, 5);

    assert.equal(rejected(codes.slice(0, 2)), 0);
    assert.equal(rejected(codes.slice(2)), 3);
    assert.equal(store.calls, 2);
  });

  test("under the local backstop, the global limit still decides", async () => {
    const store = countingStore();
    const app = exchangeApp({ exchangeMax: 2, exchangeLocalMax: 10, exchangeStore: store });

    const codes = await send(app, 4);

    assert.equal(rejected(codes), 2);
    assert.equal(store.calls, 4);
  });

  test("the backstop counts per node, not per client IP", async () => {
    const store = countingStore();
    const app = exchangeApp({ exchangeMax: 10, exchangeLocalMax: 2, exchangeStore: store });
    app.set("trust proxy", true);

    const codes = [];
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      codes.push((await request(app).post("/exchange").set("X-Forwarded-For", ip).send(exchangeBody)).status);
    }

    assert.equal(rejected(codes), 1);
  });

  test("off (exchangeLocalMax 0): every request reaches the store, as measured in tactic 2", async () => {
    const store = countingStore();
    const app = exchangeApp({ exchangeMax: 2, exchangeLocalMax: 0, exchangeStore: store });

    await send(app, 4);

    assert.equal(store.calls, 4);
  });

  test("ignored without a global store: local mode keeps one limit per node and IP", async () => {
    const app = exchangeApp({ exchangeMax: 10, exchangeLocalMax: 1 });

    const codes = await send(app, 3);

    assert.equal(rejected(codes), 0);
  });
});
