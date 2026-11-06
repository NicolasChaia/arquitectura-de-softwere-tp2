import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ArcaClient } from "../../external/arca.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function client(fetchFn, metrics) {
  return new ArcaClient({ baseUri: "http://arca:8080", timeoutMs: 50, metrics, fetchFn });
}

function fakeMetrics() {
  const events = [];
  return {
    events,
    increment: (name) => events.push(name),
    timing: (name, ms, tags) => events.push(`${name}|${tags.join(",")}`),
  };
}

describe("ArcaClient", () => {
  test("POSTs {dni} as JSON to /validar", async () => {
    let seen;
    const arca = client(async (url, opts) => {
      seen = { url, method: opts.method, body: JSON.parse(opts.body) };
      return jsonResponse(200, { ok: true, codigoAutorizacion: "abc" });
    });

    await arca.validar("40101235");

    assert.deepEqual(seen, { url: "http://arca:8080/validar", method: "POST", body: { dni: "40101235" } });
  });

  test("200 {ok:true} -> approved with the authorization code", async () => {
    const metrics = fakeMetrics();
    const arca = client(async () => jsonResponse(200, { ok: true, codigoAutorizacion: "abc" }), metrics);

    const result = await arca.validar("40101235");

    assert.equal(result.status, "approved");
    assert.equal(result.codigoAutorizacion, "abc");
    assert.equal(typeof result.latencyMs, "number");
    assert.ok(metrics.events.includes("arca.validation.approved"));
    assert.ok(metrics.events.includes("arca.latency|result:approved"));
  });

  for (const status of [200, 403]) {
    test(`${status} {ok:false} -> rejected`, async () => {
      const arca = client(async () => jsonResponse(status, { ok: false }));

      assert.equal((await arca.validar("40101235")).status, "rejected");
    });
  }

  test("5xx -> error bad_response", async () => {
    const arca = client(async () => jsonResponse(500, { ok: false }));

    const result = await arca.validar("40101235");

    assert.equal(result.status, "error");
    assert.equal(result.reason, "bad_response");
  });

  test("non-JSON body -> error bad_response", async () => {
    const arca = client(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } }));

    assert.equal((await arca.validar("40101235")).reason, "bad_response");
  });

  test("no answer within timeoutMs -> error timeout (does not hang)", async () => {
    const metrics = fakeMetrics();
    const arca = client(
      (url, { signal }) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      metrics
    );

    const result = await arca.validar("40101235");

    assert.equal(result.status, "error");
    assert.equal(result.reason, "timeout");
    assert.ok(metrics.events.includes("arca.error.timeout"));
  });

  test("connection refused -> error unreachable", async () => {
    const arca = client(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });

    const result = await arca.validar("40101235");

    assert.equal(result.reason, "unreachable");
    assert.equal(result.detail, "ECONNREFUSED");
  });
});
