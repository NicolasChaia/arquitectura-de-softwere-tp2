import { nanoid } from "nanoid";

export class ExchangeService {
  // `transfer` is injectable so tests can control/observe both legs of the
  // exchange (success, failure, ordering) instead of depending on the
  // random 200-400ms stub, which always resolves true and never exercises
  // the reconciliation branches below.
  constructor(accountsRepository, ratesRepository, logRepository, metrics, transferFn = transfer) {
    this.accountsRepository = accountsRepository;
    this.ratesRepository = ratesRepository;
    this.logRepository = logRepository;
    this.metrics = metrics;
    this.transfer = transferFn;
  }

  // executes an exchange operation
  async exchange(exchangeRequest) {
    const {
      baseCurrency,
      counterCurrency,
      baseAccountId: clientBaseAccountId,
      counterAccountId: clientCounterAccountId,
      baseAmount,
    } = exchangeRequest;

    // get the exchange rate
    const exchangeRate = this.ratesRepository.getRate(baseCurrency, counterCurrency);
    // compute the requested (counter) amount
    const counterAmount = baseAmount * exchangeRate;
    const [baseAccount, counterAccount] = await Promise.all([
      this.accountsRepository.getAccountByCurrency(baseCurrency),
      this.accountsRepository.getAccountByCurrency(counterCurrency),
    ]);

    // construct the result object with defaults
    const exchangeResult = {
      id: nanoid(),
      ts: new Date(),
      ok: false,
      request: exchangeRequest,
      exchangeRate: exchangeRate,
      counterAmount: 0.0,
      obs: null,
    };

    const reservation = await this.accountsRepository.atomicFundsTransfer(
      baseAccount.id,
      baseAmount,
      counterAccount.id,
      counterAmount
    );

    if (!reservation.ok && reservation.reason === "insufficient_funds") {
      exchangeResult.obs = "Not enough funds on counter currency account";
    }

    const reserved = reservation.ok;

    if (reserved) {
      // Introduce Concurrency: both legs are independent after the reservation,
      // so launch them together. Latency floor becomes max(t1, t2) instead of t1+t2.
      const [inflow, outflow] = await Promise.allSettled([
        this.transfer(clientBaseAccountId, baseAccount.id, baseAmount),
        this.transfer(counterAccount.id, clientCounterAccountId, counterAmount),
      ]);

      const inflowOk = inflow.status === "fulfilled" && inflow.value === true;
      const outflowOk = outflow.status === "fulfilled" && outflow.value === true;

      if (inflowOk && outflowOk) {
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;
        this.recordVolume(baseCurrency, counterCurrency, baseAmount, counterAmount);
      } else if (inflowOk && !outflowOk) {
        // Client was charged but not paid: reverse the charge, then undo reservation.
        await this.transfer(baseAccount.id, clientBaseAccountId, baseAmount);
        await this.releaseReservation(
          baseAccount.id,
          counterAccount.id,
          baseAmount,
          counterAmount
        );
        exchangeResult.obs = "Could not transfer to clients' account";
      } else if (!inflowOk && outflowOk) {
        // Client was paid but not charged: recover the payout, then undo reservation.
        // This intermediate state only appears with concurrent transfers.
        await this.transfer(clientCounterAccountId, counterAccount.id, counterAmount);
        await this.releaseReservation(
          baseAccount.id,
          counterAccount.id,
          baseAmount,
          counterAmount
        );
        exchangeResult.obs = "Could not withdraw from clients' account";
      } else {
        // Neither leg succeeded: only release the reservation.
        await this.releaseReservation(
          baseAccount.id,
          counterAccount.id,
          baseAmount,
          counterAmount
        );
        exchangeResult.obs = "Could not withdraw from clients' account";
      }
    }

    // log the transaction and return it
    this.logRepository.addLog(exchangeResult);

    return exchangeResult;
  }

  // volume and net per currency
  recordVolume(baseCurrency, counterCurrency, baseAmount, counterAmount) {
    if (!this.metrics) {
      return;
    }

    this.metrics.count(`volume.${baseCurrency}`, Number(baseAmount));
    this.metrics.count(`volume.${counterCurrency}`, counterAmount);
    this.metrics.count(`net.${baseCurrency}`, Number(baseAmount));
    this.metrics.count(`net.${counterCurrency}`, -counterAmount);
  }

  // undo a reservation made in exchange() when the external transfers
  // didn't go through after all
  async releaseReservation(baseAccountId, counterAccountId, baseAmount, counterAmount) {
    await this.accountsRepository.atomicAdjustTwo(
      baseAccountId,
      -baseAmount,
      counterAccountId,
      counterAmount
    );
  }
}

// internal - call transfer service to execute transfer between accounts
async function transfer(fromAccountId, toAccountId, amount) {
  const min = 200;
  const max = 400;
  return new Promise((resolve) =>
    setTimeout(() => resolve(true), Math.random() * (max - min + 1) + min)
  );
}
