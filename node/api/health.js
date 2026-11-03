import { Router } from "express";

import { getRedisClient } from "../repository/redisClient.js";

const REDIS_PING_TIMEOUT_MS = 500;

export function createHealthRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      await Promise.race([
        getRedisClient().ping(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Redis ping timed out")),
            REDIS_PING_TIMEOUT_MS
          )
        ),
      ]);

      res.status(200).json({
        status: "ok",
        redis: "up",
        uptime: process.uptime(),
      });
    } catch {
      res.status(503).json({
        status: "degraded",
        redis: "down",
      });
    }
  });

  return router;
}
