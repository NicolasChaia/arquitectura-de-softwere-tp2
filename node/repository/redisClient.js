import { createClient } from "redis";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let client = null;

export async function connectRedis() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  client = createClient({ url });
  client.on("error", (err) => console.error("Redis client error:", err));
  await client.connect();
  return client;
}

export function getRedisClient() {
  if (client == null) {
    throw new Error("Redis client is not connected");
  }
  return client;
}

// used by test teardown to close the connection cleanly between runs
export async function disconnectRedis() {
  if (client != null) {
    await client.quit();
    client = null;
  }
}

async function readSeedFile(seedFile) {
  const filePath = path.join(__dirname, "../state", seedFile);
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadOrSeed(key, seedFile) {
  const redis = getRedisClient();

  try {
    const raw = await redis.get(key);

    if (raw != null) {
      return JSON.parse(raw);
    }

    console.error(`${key} not found in Redis, seeding from ${seedFile}`);
    const seed = await readSeedFile(seedFile);
    await redis.set(key, JSON.stringify(seed));
    return seed;
  } catch (err) {
    console.error(`Error loading ${key} from Redis:`, err);
    return await readSeedFile(seedFile);
  }
}

export function scheduleSnapshot(key, getData, period) {
  const timer = setInterval(async () => {
    try {
      const data = getData();
      await getRedisClient().set(key, JSON.stringify(data));
    } catch (err) {
      console.error(`Error writing ${key} to Redis:`, err);
    }
  }, period);

  // don't let the periodic snapshot keep the process (or a test runner) alive
  timer.unref();
  return timer;
}
