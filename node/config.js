import fs from 'fs';

function readRedisOptions() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }
  try {
    const { host, port, password, tls } = JSON.parse(
      fs.readFileSync(new URL('./redis.json', import.meta.url), 'utf8')
    );
    return { socket: { host, port, tls: Boolean(tls) }, password };
  } catch {
    return { url: 'redis://localhost:6379' };
  }
}

export default {
  // Base uri for ARCA service
  arcaUri: '',
  arcaTimeoutMs: Number(process.env.ARCA_TIMEOUT_MS) || 3000,
  // Retries after an ARCA 5xx (tactic 1). Set per deploy by Ansible (arca_retries).
  arcaRetries: Number(process.env.ARCA_RETRIES) || 0,
  // POST /exchange rate limit (tactic 2). 'local': per node and per client IP,
  // in memory (as measured up to results/2-nodos-f1as). 'global': one counter
  // in Redis for the whole system. Set per deploy by Ansible.
  rateLimitMode: process.env.RATE_LIMIT_MODE === 'global' ? 'global' : 'local',
  exchangeRateLimit: Number(process.env.EXCHANGE_RATE_LIMIT) || 500,
  redis: readRedisOptions(),
};
