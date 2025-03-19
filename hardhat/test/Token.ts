import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { viem } from 'hardhat';
import { getContract, TransactionReceipt, keccak256, toHex } from 'viem';
import chai from 'chai';

// Define types for the fixture return value
interface TokenFixture {
  token: ReturnType<typeof getContract>;
  owner: string;
  addr1: string;
  addr2: string;
}

describe('Token contract', function () {
  // Fixture to deploy the Token contract and set up accounts
  async function deployTokenFixture(): Promise<TokenFixture> {
    // Get Hardhat's Viem clients
    const publicClient = await viem.getPublicClient();
    const [ownerWallet, addr1Wallet, addr2Wallet] = await viem.getWalletClients();

    // Deploy the Token contract using a wallet client
    const token = await viem.deployContract('Token', []);

    return {
      token,
      owner: ownerWallet.account.address,
      addr1: addr1Wallet.account.address,
      addr2: addr2Wallet.account.address,
    };
  }

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      const contractOwner = (await token.read.owner()) as string;
      expect(contractOwner.toLowerCase()).to.equal(owner.toLowerCase());
    });

    it('Should assign the total supply of tokens to the owner', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      const ownerBalance = (await token.read.balanceOf([owner])) as bigint;
      const totalSupply = (await token.read.totalSupply()) as bigint;
      expect(totalSupply).to.equal(ownerBalance);
    });
  });

  describe('Transactions', function () {
    it('Should transfer tokens between accounts', async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployTokenFixture);

      // Transfer 50 tokens from owner to addr1
      const amount = BigInt(50);
      await token.write.transfer([addr1, amount]);
      const ownerBalanceAfter1 = (await token.read.balanceOf([owner])) as bigint;
      const addr1BalanceAfter1 = (await token.read.balanceOf([addr1])) as bigint;
      expect(addr1BalanceAfter1).to.equal(amount);

      // Transfer 50 tokens from addr1 to addr2
      const addr1Client = (await viem.getWalletClients())[1]; // addr1's wallet client
      await token.write.transfer([addr2, amount], { account: addr1Client.account });
      const addr1BalanceAfter2 = (await token.read.balanceOf([addr1])) as bigint;
      const addr2BalanceAfter2 = (await token.read.balanceOf([addr2])) as bigint;
      expect(addr1BalanceAfter2).to.equal(BigInt(0));
      expect(addr2BalanceAfter2).to.equal(amount);
    });

    it('should emit Transfer events', async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployTokenFixture);
      const publicClient = await viem.getPublicClient();

      const amount = BigInt(50);
      const txHash1 = await token.write.transfer([addr1, amount]);
      const receipt1 = await publicClient.waitForTransactionReceipt({ hash: txHash1 });
      await expect(receipt1).to.emit(token, 'Transfer').withArgs(owner, addr1, amount);

      const addr1Client = (await viem.getWalletClients())[1];
      const txHash2 = await token.write.transfer([addr2, amount], { account: addr1Client.account });
      const receipt2 = await publicClient.waitForTransactionReceipt({ hash: txHash2 });
      await expect(receipt2).to.emit(token, 'Transfer').withArgs(addr1, addr2, amount);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const { token, owner, addr1 } = await loadFixture(deployTokenFixture);
      const initialOwnerBalance = (await token.read.balanceOf([owner])) as bigint;

      // Try to send 1 token from addr1 (0 tokens) to owner
      const addr1Client = (await viem.getWalletClients())[1];
      await expect(
        token.write.transfer([owner, BigInt(1)], { account: addr1Client.account })
      ).to.be.rejectedWith('Not enough tokens');

      // Owner balance shouldn't have changed
      const finalOwnerBalance = (await token.read.balanceOf([owner])) as bigint;
      expect(finalOwnerBalance).to.equal(initialOwnerBalance);
    });
  });
});

// Extend Chai with a custom .to.emit matcher for Viem
declare global {
  namespace Chai {
    interface Assertion {
      emit(contract: any, eventName: string): Assertion;
      withArgs(...args: any[]): Assertion;
    }
  }
}

chai.use(function (chai, utils) {
  const Assertion = chai.Assertion;

  Assertion.addMethod('emit', function (this: any, contract: any, eventName: string) {
    const receipt: TransactionReceipt = this._obj;
    const eventAbi = contract.abi.find((e: any) => e.type === 'event' && e.name === eventName);
    if (!eventAbi) throw new Error(`Event ${eventName} not found in contract ABI`);

    // Compute the correct event signature: only types, no names or 'indexed'
    const eventInputs = eventAbi.inputs.map((input: any) => input.type).join(',');
    const eventString = `${eventName}(${eventInputs})`; // e.g., "Transfer(address,address,uint256)"
    const eventSignature = keccak256(toHex(eventString));
    const logs = receipt.logs ?? [];
    const log = logs.find((l) => l.topics[0] === eventSignature);

    this.assert(
      log !== undefined,
      `Expected event "${eventName}" to be emitted, but it was not`,
      `Expected event "${eventName}" not to be emitted, but it was`,
      eventName
    );

    utils.flag(this, 'eventLog', log);
    utils.flag(this, 'eventAbi', eventAbi);
  });

  Assertion.addMethod('withArgs', function (this: any, ...expectedArgs: any[]) {
    const log = utils.flag(this, 'eventLog');
    const eventAbi = utils.flag(this, 'eventAbi');
    if (!log) throw new Error('Use .emit before .withArgs');

    const indexedArgs = log.topics.slice(1).map((topic: string) => `0x${topic.slice(-40)}`.toLowerCase());
    const nonIndexedArgs = eventAbi.inputs.length > log.topics.length - 1 
      ? [BigInt(log.data)] 
      : [];
    const actualArgs = [...indexedArgs, ...nonIndexedArgs];
    const formattedExpectedArgs = expectedArgs.map((arg) =>
      typeof arg === 'bigint' ? arg : arg.toLowerCase()
    );

    this.assert(
      actualArgs.length === expectedArgs.length &&
      actualArgs.every((arg, i) => arg === formattedExpectedArgs[i]),
      `Expected event args ${formattedExpectedArgs} but got ${actualArgs}`,
      `Expected event args not to be ${formattedExpectedArgs}`,
      expectedArgs
    );
  });
});