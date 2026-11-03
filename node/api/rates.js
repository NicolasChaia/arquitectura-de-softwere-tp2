import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";

export function createRatesRouter(ratesService) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json(ratesService.getRates());
  });

  router.put("/", (req, res, next) => {
    const { baseCurrency, counterCurrency, rate } = req.body;

    if (!baseCurrency || !counterCurrency || !rate) {
      return next(new MalformedRequestError());
    }

    try {
      ratesService.setRate(req.body);
      res.json(ratesService.getRates());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
