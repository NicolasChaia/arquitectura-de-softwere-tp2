const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 500;

export class LogService {
  constructor(repository) {
    this.repository = repository;
  }

  // returns the most recent log entries, capped to avoid unbounded payloads
  async getLog(limit = DEFAULT_LOG_LIMIT) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LOG_LIMIT);
    return await this.repository.getLog(safeLimit);
  }
}

export { DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT };
