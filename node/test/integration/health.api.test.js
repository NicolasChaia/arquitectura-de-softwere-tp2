import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp } from "./helpers/buildTestApp.js";

describe("/health (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  test("reports ok/up while Redis is reachable", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/health");

    assert.equal(res.status, 200);
    assert.deepEqual(
      { status: res.body.status, redis: res.body.redis },
      { status: "ok", redis: "up" }
    );
  });

  test("reports degraded/down when Redis is unreachable", async () => {
    const { app } = await buildTestApp();

    // disconnect the shared client to simulate Redis being down; this is
    // the last test in this file/process, so nothing after it needs Redis
    await teardownRedis();

    const res = await request(app).get("/health");

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { status: "degraded", redis: "down" });
  });
});
