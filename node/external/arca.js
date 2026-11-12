// Client for ARCA's fiscal validation API (POST /validar).

export class ArcaClient {
  // `retries`: extra attempts after an HTTP 5xx from ARCA (tactic 1, see
  // perf/predicciones.md P6). ARCA's 5xx are random per call (~26 %, not tied
  // to the DNI) and come back in ~6 ms, so retrying is cheap and usually
  // succeeds. Timeouts and unreachable are not retried: when ARCA does not
  // answer, another call only adds load to a resource that is already behind.
  constructor({ baseUri, timeoutMs, metrics, fetchFn = fetch, retries = 0 }) {
    this.url = `${baseUri}/validar`;
    this.timeoutMs = timeoutMs;
    this.metrics = metrics;
    this.fetch = fetchFn;
    this.retries = retries;
  }

  async validar(dni) {
    const start = performance.now();
    let result = await this.call(dni);
    let attempts = 1;
    while (isRetryable(result) && attempts <= this.retries) {
      this.metrics?.increment("arca.retry");
      result = await this.call(dni);
      attempts++;
    }
    result.attempts = attempts;
    result.latencyMs = Math.round(performance.now() - start);

    if (this.metrics) {
      this.metrics.timing("arca.latency", result.latencyMs, [`result:${result.status}`]);
      this.metrics.increment(`arca.validation.${result.status}`);
      if (result.reason) {
        this.metrics.increment(`arca.error.${result.reason}`);
      }
    }

    return result;
  }

  async call(dni) {
    let res;
    try {
      res = await this.fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err.name === "TimeoutError" ? "timeout" : "unreachable";
      return { status: "error", reason, detail: err.cause?.code ?? err.message };
    }

    let body;
    try {
      body = await res.json();
    } catch {
      return {
        status: "error",
        reason: "bad_response",
        detail: `HTTP ${res.status}, non-JSON body`,
        httpStatus: res.status,
      };
    }

    if (body?.ok === true && res.ok) {
      return { status: "approved", codigoAutorizacion: body.codigoAutorizacion };
    }
    // a rejection may come as 200 {ok:false} or as a 4xx {ok:false}
    if (body?.ok === false && res.status < 500) {
      return { status: "rejected" };
    }
    return { status: "error", reason: "bad_response", detail: `HTTP ${res.status}`, httpStatus: res.status };
  }
}

function isRetryable(result) {
  return result.status === "error" && result.httpStatus >= 500;
}
