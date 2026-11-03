import { Router } from "express";

import { MalformedRequestError } from "../exceptions/errors.js";

export function createAccountsRouter(accountsService) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json(await accountsService.getAccounts());
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/balance", async (req, res, next) => {
    const accountId = req.params.id;
    const { balance } = req.body;

    if (!accountId || !balance) {
      return next(new MalformedRequestError());
    }

    try {
      await accountsService.setAccountBalance(accountId, balance);
      res.json(await accountsService.getAccounts());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
