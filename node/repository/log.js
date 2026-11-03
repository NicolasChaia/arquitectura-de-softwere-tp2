import { loadOrSeed, scheduleSnapshot } from "./redisClient.js";

// Retention cap: without this, the log grows without bound and eventually
// exhausts the process heap under sustained write load.
const MAX_STORED_ENTRIES = 10000;

export class LogRepository {
  constructor() {
    this.log = null;
  }

  async init() {
    this.log = await loadOrSeed("log", "log.json");
    trim(this.log);
    scheduleSnapshot("log", () => this.log, 1000);
  }

  getLog() {
    return this.log;
  }

  addLog(entry) {
    this.log.push(entry);
    trim(this.log);
  }
}

function trim(log) {
  if (log.length > MAX_STORED_ENTRIES) {
    log.splice(0, log.length - MAX_STORED_ENTRIES);
  }
}
