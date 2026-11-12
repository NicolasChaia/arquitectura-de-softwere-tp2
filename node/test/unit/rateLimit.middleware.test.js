import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { createRateLimiter } from "../../middleware/rateLimit.js";
import { RedisWindowStore } from "../../middleware/redisWindowStore.js";

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
