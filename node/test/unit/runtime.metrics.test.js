import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createRuntimeSampler } from "../../metrics/runtime.js";

function fakeMetrics() {
  const gauges = [];
  return { gauges, gauge: (name, value) => gauges.push({ name, value }) };
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // keep the main thread busy
  }
}

describe("runtime metrics", () => {
  test("sends event loop utilization and process CPU as gauges", () => {
    const metrics = fakeMetrics();
    const sample = createRuntimeSampler(metrics);

    busyWait(50);
    const { elu, cores } = sample();

    assert.deepEqual(
      metrics.gauges.map((g) => g.name),
      ["node.event_loop_utilization", "node.process_cpu_cores"]
    );
    assert.ok(elu >= 0 && elu <= 1, `elu out of range: ${elu}`);
    assert.ok(cores > 0, `a busy main thread should use CPU, got ${cores}`);
  });

  // ELU only accounts busy time once the event loop finishes an iteration, so
  // the blocking work runs inside a loop callback and the sample is taken on
  // the next turn (like the real setInterval does).
  test("ELU is high while the main thread is blocked and low while it is idle", async () => {
    const metrics = fakeMetrics();
    const sample = createRuntimeSampler(metrics);

    await new Promise((resolve) => setTimeout(() => { busyWait(100); resolve(); }, 0));
    await new Promise((resolve) => setImmediate(resolve));
    const busy = sample().elu;

    await new Promise((resolve) => setTimeout(resolve, 100));
    const idle = sample().elu;

    assert.ok(busy > 0.8, `expected ELU > 0.8 while blocked, got ${busy}`);
    assert.ok(idle < 0.3, `expected ELU < 0.3 while idle, got ${idle}`);
  });
});
