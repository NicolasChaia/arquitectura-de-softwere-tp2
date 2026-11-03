import { connectRedis, disconnectRedis, getRedisClient } from "../../../repository/redisClient.js";

// Integration tests need a real Redis (they exercise the Lua scripts and
// the actual atomicity guarantees, not a mock of them). Point REDIS_URL at
// a disposable instance, e.g.:
//   docker run -d --rm --name test-redis -p 6379:6379 redis:7.4
// Uses db 15 by default so it never touches whatever a developer has
// running on db 0 for the app itself.
const DEFAULT_TEST_REDIS_URL = "redis://localhost:6379/15";

export async function setupRedis() {
  process.env.REDIS_URL = process.env.REDIS_URL || DEFAULT_TEST_REDIS_URL;
  const client = await connectRedis();
  await client.flushDb();
  return client;
}

export async function resetRedis() {
  await getRedisClient().flushDb();
}

export async function teardownRedis() {
  await disconnectRedis();
}
