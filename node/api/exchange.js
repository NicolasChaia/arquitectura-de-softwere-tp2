import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";

export function createExchangeRouter(exchangeService) {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const {
      baseCurrency,
      counterCurrency,
      baseAccountId,
      counterAccountId,
      baseAmount,
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

    try {
      const exchangeResult = await exchangeService.exchange({ ...req.body });

      if (exchangeResult.ok) {
        res.status(200).json(exchangeResult);
      } else {
        res.status(500).json(exchangeResult);
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
