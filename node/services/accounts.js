export class AccountsService {
  constructor(repository) {
    this.repository = repository;
  }

  // returns all internal accounts
  async getAccounts() {
    return await this.repository.getAccounts();
  }

  // sets balance for an account
  async setAccountBalance(accountId, balance) {
    await this.repository.setAccountBalance(accountId, balance);
  }
}
