// Server-side response time, sent to Datadog.

const KNOWN_ROUTES = new Set(["exchange", "accounts", "rates", "log", "health"]);

export function routeTag(path) {
  const first = path.split("/")[1] ?? "";
  if (first === "") return "/";
  return KNOWN_ROUTES.has(first) ? `/${first}` : "other";
}

export function createResponseTimeMiddleware(metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split("?")[0];
      metrics.timing("http.response_time", ms, [
        `route:${routeTag(path)}`,
        `method:${req.method}`,
        `status:${res.statusCode}`,
      ]);
    });
    next();
  };
}
