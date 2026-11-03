import { createClient } from "redis";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

import config from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let client = null;

// `options` is either { url } (local / tests) or { socket: { host, port, tls }, password }
// (Azure Managed Redis, see config.js). A plain string is taken as a url.
export async function connectRedis(options = config.redis) {
  client = createClient(typeof options === "string" ? { url: options } : options);
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

export async function readSeedFile(seedFile) {
  const filePath = path.join(__dirname, "../state", seedFile);
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}
