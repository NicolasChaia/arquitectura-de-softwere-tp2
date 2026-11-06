// Client for ARCA's fiscal validation API (POST /validar).

export class ArcaClient {
  constructor({ baseUri, timeoutMs, metrics, fetchFn = fetch }) {
    this.url = `${baseUri}/validar`;
    this.timeoutMs = timeoutMs;
    this.metrics = metrics;
    this.fetch = fetchFn;
  }

  async validar(dni) {
    const start = performance.now();
    const result = await this.call(dni);
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
      return { status: "error", reason: "bad_response", detail: `HTTP ${res.status}, non-JSON body` };
    }

    if (body?.ok === true && res.ok) {
      return { status: "approved", codigoAutorizacion: body.codigoAutorizacion };
    }
    // a rejection may come as 200 {ok:false} or as a 4xx {ok:false}
    if (body?.ok === false && res.status < 500) {
      return { status: "rejected" };
    }
    return { status: "error", reason: "bad_response", detail: `HTTP ${res.status}` };
  }
}
