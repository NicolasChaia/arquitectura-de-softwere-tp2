import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { setupRedis, resetRedis, teardownRedis } from "./helpers/testRedis.js";
import { buildTestApp, fakeArca } from "./helpers/buildTestApp.js";

const exchangeBody = (overrides = {}) => ({
  baseCurrency: "ARS",
  counterCurrency: "USD",
  baseAccountId: "client-1",
  counterAccountId: "client-2",
  baseAmount: 100,
  dni: "40101235",
  ...overrides,
});

describe("TP2: GET /, DNI validation, ARCA outcomes and multi-node state (integration)", () => {
  before(async () => {
    await setupRedis();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  after(async () => {
    await teardownRedis();
  });

  test("GET / answers without touching Redis or ARCA (baseline latency endpoint)", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).get("/");

    assert.equal(res.status, 200);
    assert.equal(res.text, "Server is up.");
  });

  for (const dni of [undefined, 40101235, "abc", "999999", "100000000", "4010 1235"]) {
    test(`POST /exchange 400s on an invalid dni (${JSON.stringify(dni)})`, async () => {
      const { app } = await buildTestApp();

      const res = await request(app).post("/exchange").send(exchangeBody({ dni }));

      assert.equal(res.status, 400);
    });
  }

  test("boundary DNIs 1000000 and 99999999 are accepted", async () => {
    const { app } = await buildTestApp();

    for (const dni of ["1000000", "99999999"]) {
      const res = await request(app).post("/exchange").send(exchangeBody({ dni }));
      assert.equal(res.status, 200, `dni ${dni}`);
    }
  });

  test("approved: 200 with ARCA's authorization code, also stored in /log", async () => {
    const { app } = await buildTestApp();

    const res = await request(app).post("/exchange").send(exchangeBody());
    const log = await request(app).get("/log");

    assert.equal(res.status, 200);
    assert.equal(res.body.arca.codigoAutorizacion, "test-auth-code");
    assert.equal(log.body[0].arca.codigoAutorizacion, "test-auth-code");
  });

  test("rejected by ARCA: 403, balances untouched, rejection stored in /log", async () => {
    const { app, accountsRepository } = await buildTestApp({
      arcaClient: fakeArca({ status: "rejected", latencyMs: 1 }),
    });
    const before = await accountsRepository.getAccounts();

    const res = await request(app).post("/exchange").send(exchangeBody());
    const log = await request(app).get("/log");

    assert.equal(res.status, 403);
    assert.equal(res.body.failure, "arca_rejected");
    assert.deepEqual(await accountsRepository.getAccounts(), before);
    assert.equal(log.body[0].arca.status, "rejected");
  });

  test("ARCA unavailable: 503, balances untouched", async () => {
    const { app, accountsRepository } = await buildTestApp({
      arcaClient: fakeArca({ status: "error", reason: "timeout", latencyMs: 3000 }),
    });
    const before = await accountsRepository.getAccounts();

    const res = await request(app).post("/exchange").send(exchangeBody());

    assert.equal(res.status, 503);
    assert.equal(res.body.failure, "arca_unavailable");
    assert.deepEqual(await accountsRepository.getAccounts(), before);
  });

  // Two app instances sharing one Redis = two VMSS nodes behind the LB.
  test("two nodes: a rate set on node A is used by node B", async () => {
    const nodeA = await buildTestApp();
    const nodeB = await buildTestApp();

    await request(nodeA.app)
      .put("/rates")
      .send({ baseCurrency: "USD", counterCurrency: "ARS", rate: 2000 });
    const rates = await request(nodeB.app).get("/rates");

    assert.equal(rates.body.USD.ARS, 2000);
  });

  test("two nodes: exchanges made on either node show up in a single, shared log", async () => {
    const nodeA = await buildTestApp();
    const nodeB = await buildTestApp();

    await request(nodeA.app).post("/exchange").send(exchangeBody());
    await request(nodeB.app).post("/exchange").send(exchangeBody());
    await request(nodeA.app).post("/exchange").send(exchangeBody());

    const logFromA = await request(nodeA.app).get("/log");
    const logFromB = await request(nodeB.app).get("/log");

    assert.equal(logFromA.body.length, 3);
    assert.deepEqual(logFromA.body, logFromB.body);
  });

  test("two nodes starting at the same time seed the accounts exactly once", async () => {
    await Promise.all([buildTestApp(), buildTestApp(), buildTestApp()]);
    const { accountsRepository } = await buildTestApp();

    const accounts = await accountsRepository.getAccounts();

    assert.deepEqual(accounts.map((a) => a.id), [1, 2, 3, 4]);
  });
});
