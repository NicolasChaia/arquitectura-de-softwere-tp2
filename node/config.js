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
  redis: readRedisOptions(),
};
