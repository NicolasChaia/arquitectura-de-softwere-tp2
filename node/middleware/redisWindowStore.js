import { getRedisClient } from "../repository/redisClient.js";

// express-rate-limit store backed by the shared Redis, so every node of the
// VMSS counts against the same limit (tactic 2, see perf/predicciones.md P7).
// The default store counts in each process' memory: with N nodes the limit
// becomes N x max.
//
// Fixed window aligned to the clock (key suffix = window number), so all
// nodes use the same window without coordinating. One EVAL per request:
// INCR, plus PEXPIRE when the window starts so old windows go away
// (the instance runs with NoEviction).
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return hits
`;

export class RedisWindowStore {
  constructor({ prefix = "ratelimit:", getClient = getRedisClient, now = Date.now } = {}) {
    this.prefix = prefix;
    this.getClient = getClient;
    this.now = now;
    // keys are shared between instances (nodes): not local
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  windowKey(key) {
    const window = Math.floor(this.now() / this.windowMs);
    return { redisKey: `${this.prefix}${key}:${window}`, resetTime: new Date((window + 1) * this.windowMs) };
  }

  async increment(key) {
    const { redisKey, resetTime } = this.windowKey(key);
    const totalHits = await this.getClient().eval(INCREMENT_SCRIPT, {
      keys: [redisKey],
      arguments: [String(2 * this.windowMs)],
    });
    return { totalHits: Number(totalHits), resetTime };
  }

  async decrement(key) {
    await this.getClient().decr(this.windowKey(key).redisKey);
  }

  async resetKey(key) {
    await this.getClient().del(this.windowKey(key).redisKey);
  }
}
