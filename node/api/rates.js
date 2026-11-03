import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";

export function createRatesRouter(ratesService) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json(await ratesService.getRates());
    } catch (err) {
      next(err);
    }
  });

  router.put("/", async (req, res, next) => {
    const { baseCurrency, counterCurrency, rate } = req.body;

    if (!baseCurrency || !counterCurrency || !rate) {
      return next(new MalformedRequestError());
    }

    try {
      await ratesService.setRate(req.body);
      res.json(await ratesService.getRates());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
