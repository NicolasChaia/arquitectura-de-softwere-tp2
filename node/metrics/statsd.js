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
  count(name, value) {
    this.send(`${this.prefix}.${name}:${value}|c`);
  }

  send(message) {
    this.socket.send(message, this.port, this.host, (err) => {
      if (err) {
        console.error("StatsD send error:", err.message);
      }
    });
  }
}
