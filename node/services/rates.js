import { InvalidRateError } from "../exceptions/errors.js";

export class RatesService {
  constructor(repository) {
    this.repository = repository;
  }

  // returns all current exchange rates
  getRates() {
    return this.repository.getRates();
  }

  // sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
  setRate({ baseCurrency, counterCurrency, rate }) {
    if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) {
      throw new InvalidRateError("rate must be a positive finite number");
    }

    this.repository.setRate(baseCurrency, counterCurrency, rate);
    this.repository.setRate(
      counterCurrency,
      baseCurrency,
      Number((1 / rate).toFixed(5))
    );
  }
}
