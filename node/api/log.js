import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";
import { DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT } from "../services/log.js";

export function createLogRouter(logService) {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit);
      res.json(logService.getLog(limit));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseLimit(rawLimit) {
  if (rawLimit === undefined) {
    return DEFAULT_LOG_LIMIT;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
    throw new MalformedRequestError(
      `limit must be an integer between 1 and ${MAX_LOG_LIMIT}`
    );
  }

  return limit;
}
