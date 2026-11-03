import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LogService, DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT } from "../../services/log.js";

function fakeRepository(entries) {
  return { getLog: () => entries };
}

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe("LogService", () => {
  test("returns everything when there are fewer entries than the limit", () => {
    const service = new LogService(fakeRepository(entries(3)));

    assert.deepEqual(service.getLog(10), entries(3));
  });

  test("returns exactly the limit worth of entries when there are more", () => {
    const service = new LogService(fakeRepository(entries(250)));

    const result = service.getLog(10);

    assert.equal(result.length, 10);
  });

  test("keeps the most recent entries, not the oldest, when trimming", () => {
    const log = entries(5); // ids 0..4
    const service = new LogService(fakeRepository(log));

    const result = service.getLog(2);

    assert.deepEqual(result.map((e) => e.id), [3, 4]);
  });

  test("defaults to DEFAULT_LOG_LIMIT when no limit is given", () => {
    const service = new LogService(fakeRepository(entries(DEFAULT_LOG_LIMIT + 50)));

    const result = service.getLog();

    assert.equal(result.length, DEFAULT_LOG_LIMIT);
  });

  test("clamps a limit above MAX_LOG_LIMIT down to MAX_LOG_LIMIT", () => {
    const service = new LogService(fakeRepository(entries(MAX_LOG_LIMIT + 100)));

    const result = service.getLog(MAX_LOG_LIMIT + 100);

    assert.equal(result.length, MAX_LOG_LIMIT);
  });

  test("clamps a limit below 1 up to 1", () => {
    const service = new LogService(fakeRepository(entries(10)));

    const result = service.getLog(0);

    assert.equal(result.length, 1);
  });

  test("clamps a negative limit up to 1", () => {
    const service = new LogService(fakeRepository(entries(10)));

    const result = service.getLog(-5);

    assert.equal(result.length, 1);
  });
});
