import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";

const MIN_DNI = 1000000;
const MAX_DNI = 99999999;

function isValidDni(dni) {
  return typeof dni === "string" && /^\d+$/.test(dni) && Number(dni) >= MIN_DNI && Number(dni) <= MAX_DNI;
}

const FAILURE_STATUS = {
  arca_rejected: 403,
  insufficient_funds: 409,
  arca_unavailable: 503,
};

export function createExchangeRouter(exchangeService) {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const {
      baseCurrency,
      counterCurrency,
      baseAccountId,
      counterAccountId,
      baseAmount,
      dni,
    } = req.body;

    if (
      !baseCurrency ||
      !counterCurrency ||
      !baseAccountId ||
      !counterAccountId ||
      !baseAmount
    ) {
      return next(new MalformedRequestError());
    }

    if (!isValidDni(dni)) {
      return next(
        new MalformedRequestError(`dni must be a string of digits between ${MIN_DNI} and ${MAX_DNI}`)
      );
    }

    try {
      const exchangeResult = await exchangeService.exchange({ ...req.body });

      if (exchangeResult.ok) {
        res.status(200).json(exchangeResult);
      } else if (FAILURE_STATUS[exchangeResult.failure]) {
        res.status(FAILURE_STATUS[exchangeResult.failure]).json(exchangeResult);
      } else {
        res.status(500).json(exchangeResult);
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
