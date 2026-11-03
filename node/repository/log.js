import { getRedisClient } from "./redisClient.js";

const LOG_KEY = "log:entries";

// Retention cap: without this, the log grows without bound and eventually
// exhausts Redis memory under sustained write load.
const MAX_STORED_ENTRIES = 10000;

export class LogRepository {
  async init() {
    // nothing to seed: an empty list is the initial state
  }

  // most recent `limit` entries, oldest first
  async getLog(limit) {
    const raw = await getRedisClient().lRange(LOG_KEY, -limit, -1);
    return raw.map((entry) => JSON.parse(entry));
  }

  // append + trim in a single round trip (MULTI/EXEC)
  async addLog(entry) {
    await getRedisClient()
      .multi()
      .rPush(LOG_KEY, JSON.stringify(entry))
      .lTrim(LOG_KEY, -MAX_STORED_ENTRIES, -1)
      .exec();
  }
}

export { MAX_STORED_ENTRIES };
