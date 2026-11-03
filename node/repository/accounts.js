import { getRedisClient } from "./redisClient.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_KEY = "accounts:index";
const accountKey = (id) => `account:${id}`;
const currencyKey = (currency) => `accounts:by_currency:${currency}`;

// Transfers debit one account and credit another. Each account lives under
// its own hash key, so this only locks the two keys involved instead of
// the whole ledger (see accounts:index for the rest of the accounts).
const TRANSFER_SCRIPT = `
local baseKey = KEYS[1]
local counterKey = KEYS[2]
local baseAmount = tonumber(ARGV[1])
local counterAmount = tonumber(ARGV[2])

if redis.call('EXISTS', baseKey) == 0 or redis.call('EXISTS', counterKey) == 0 then
  return cjson.encode({ ok = false, reason = 'account_not_found' })
end

local counterBalance = tonumber(redis.call('HGET', counterKey, 'balance'))
if counterBalance < counterAmount then
  return cjson.encode({ ok = false, reason = 'insufficient_funds' })
end

local newBase = redis.call('HINCRBYFLOAT', baseKey, 'balance', baseAmount)
local newCounter = redis.call('HINCRBYFLOAT', counterKey, 'balance', -counterAmount)

return cjson.encode({ ok = true, baseBalance = tonumber(newBase), counterBalance = tonumber(newCounter) })
`;

const ADJUST_TWO_SCRIPT = `
local key1 = KEYS[1]
local key2 = KEYS[2]
local delta1 = tonumber(ARGV[1])
local delta2 = tonumber(ARGV[2])

if redis.call('EXISTS', key1) == 0 or redis.call('EXISTS', key2) == 0 then
  return cjson.encode({ ok = false, reason = 'accounts_not_found' })
end

redis.call('HINCRBYFLOAT', key1, 'balance', delta1)
redis.call('HINCRBYFLOAT', key2, 'balance', delta2)

return cjson.encode({ ok = true })
`;

export class AccountsRepository {
  async init() {
    const redis = getRedisClient();

    if ((await redis.exists(INDEX_KEY)) === 0) {
      console.error(`${INDEX_KEY} not found in Redis, seeding from accounts.json`);
      await seed(redis);
    }
  }

  async getAccounts() {
    const redis = getRedisClient();
    const ids = await redis.lRange(INDEX_KEY, 0, -1);
    return Promise.all(ids.map((id) => readAccount(redis, id)));
  }

  async getAccountById(id) {
    return readAccount(getRedisClient(), String(id));
  }

  async getAccountByCurrency(currency) {
    const redis = getRedisClient();
    const id = await redis.get(currencyKey(currency));
    return id != null ? readAccount(redis, id) : null;
  }

  async setAccountBalance(accountId, balance) {
    await getRedisClient().hSet(accountKey(accountId), "balance", String(balance));
  }

  async atomicFundsTransfer(baseAccountId, baseAmount, counterAccountId, counterAmount) {
    const raw = await getRedisClient().eval(TRANSFER_SCRIPT, {
      keys: [accountKey(baseAccountId), accountKey(counterAccountId)],
      arguments: [String(baseAmount), String(counterAmount)],
    });
    return JSON.parse(raw);
  }

  async atomicAdjustTwo(accountId1, delta1, accountId2, delta2) {
    const raw = await getRedisClient().eval(ADJUST_TWO_SCRIPT, {
      keys: [accountKey(accountId1), accountKey(accountId2)],
      arguments: [String(delta1), String(delta2)],
    });
    return JSON.parse(raw);
  }
}

async function readAccount(redis, id) {
  const fields = await redis.hGetAll(accountKey(id));
  if (fields.balance === undefined) {
    return null;
  }
  return { id: Number(id), currency: fields.currency, balance: Number(fields.balance) };
}

async function seed(redis) {
  const filePath = path.join(__dirname, "../state/accounts.json");
  const accounts = JSON.parse(await fs.promises.readFile(filePath, "utf8"));

  const multi = redis.multi();
  for (const account of accounts) {
    multi.hSet(accountKey(account.id), {
      currency: account.currency,
      balance: String(account.balance),
    });
    multi.set(currencyKey(account.currency), String(account.id));
    multi.rPush(INDEX_KEY, String(account.id));
  }
  await multi.exec();
}
