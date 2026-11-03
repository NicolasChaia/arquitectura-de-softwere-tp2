import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LogService, DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT } from "../../services/log.js";

// The repository (Redis LRANGE) returns the most recent `limit` entries; the
// service is responsible for clamping `limit` to a safe range.
function fakeRepository(entries) {
  const limits = [];
  return {
    limits,
    getLog: async (limit) => (limits.push(limit), entries.slice(-limit)),
  };
}

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe("LogService", () => {
  test("returns everything when there are fewer entries than the limit", async () => {
    const service = new LogService(fakeRepository(entries(3)));

    assert.deepEqual(await service.getLog(10), entries(3));
  });

  test("asks the repository for exactly the requested limit", async () => {
    const repository = fakeRepository(entries(250));
    const service = new LogService(repository);

    const result = await service.getLog(10);

    assert.equal(result.length, 10);
    assert.deepEqual(repository.limits, [10]);
  });

  test("defaults to DEFAULT_LOG_LIMIT when no limit is given", async () => {
    const repository = fakeRepository(entries(DEFAULT_LOG_LIMIT + 50));
    const service = new LogService(repository);

    const result = await service.getLog();

    assert.equal(result.length, DEFAULT_LOG_LIMIT);
  });

  test("clamps a limit above MAX_LOG_LIMIT down to MAX_LOG_LIMIT", async () => {
    const repository = fakeRepository(entries(MAX_LOG_LIMIT + 100));
    const service = new LogService(repository);

    await service.getLog(MAX_LOG_LIMIT + 100);

    assert.deepEqual(repository.limits, [MAX_LOG_LIMIT]);
  });

  for (const bad of [0, -5]) {
    test(`clamps a limit below 1 (${bad}) up to 1`, async () => {
      const repository = fakeRepository(entries(10));
      const service = new LogService(repository);

      const result = await service.getLog(bad);

      assert.deepEqual(repository.limits, [1]);
      assert.deepEqual(result, [{ id: 9 }]);
    });
  }
});
