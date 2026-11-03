export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class MalformedRequestError extends DomainError {
  constructor(message = "Malformed request") {
    super(message, 400);
  }
}

export class InvalidRateError extends DomainError {
  constructor(message = "Invalid rate") {
    super(message, 400);
  }
}
