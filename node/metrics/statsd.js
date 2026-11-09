import dgram from "dgram";

export class StatsdClient {
  constructor({
    host = process.env.STATSD_HOST || "localhost",
    port = Number(process.env.STATSD_PORT) || 8125,
    prefix = process.env.STATSD_PREFIX || "exchange",
  } = {}) {
    this.host = host;
    this.port = port;
    this.prefix = prefix;
    this.socket = dgram.createSocket("udp4");
    this.socket.on("error", (err) => console.error("StatsD socket error:", err));
    this.socket.unref();
  }

  // counter increment; statsd sums them per flush and accepts negative values
  count(name, value, tags) {
    this.send(`${this.prefix}.${name}:${value}|c${formatTags(tags)}`);
  }

  increment(name, tags) {
    this.count(name, 1, tags);
  }

  gauge(name, value, tags) {
    this.send(`${this.prefix}.${name}:${value}|g${formatTags(tags)}`);
  }

  // duration in ms; Datadog aggregates it into avg/median/p95/max per flush
  timing(name, ms, tags) {
    this.send(`${this.prefix}.${name}:${ms}|ms${formatTags(tags)}`);
  }

  send(message) {
    this.socket.send(message, this.port, this.host, (err) => {
      if (err) {
        console.error("StatsD send error:", err.message);
      }
    });
  }
}

// DogStatsD tag extension: "name:1|c|#tag1,tag2"
function formatTags(tags) {
  return tags && tags.length ? `|#${tags.join(",")}` : "";
}
