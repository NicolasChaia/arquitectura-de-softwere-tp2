import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AccountsService } from "../../services/accounts.js";

function fakeRepository() {
  const calls = [];
  return {
    calls,
    getAccounts: async () => {
      calls.push(["getAccounts"]);
      return [{ id: 1, currency: "ARS", balance: 100 }];
    },
    setAccountBalance: async (accountId, balance) => {
      calls.push(["setAccountBalance", accountId, balance]);
    },
  };
}

describe("AccountsService", () => {
  test("getAccounts delegates to the repository and returns its result", async () => {
    const repository = fakeRepository();
    const service = new AccountsService(repository);

    const accounts = await service.getAccounts();

    assert.deepEqual(accounts, [{ id: 1, currency: "ARS", balance: 100 }]);
    assert.deepEqual(repository.calls, [["getAccounts"]]);
  });

  test("setAccountBalance forwards accountId and balance unchanged", async () => {
    const repository = fakeRepository();
    const service = new AccountsService(repository);

    await service.setAccountBalance("2", 5000);

    assert.deepEqual(repository.calls, [["setAccountBalance", "2", 5000]]);
  });
});
