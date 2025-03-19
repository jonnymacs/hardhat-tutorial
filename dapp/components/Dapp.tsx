import React, { Component } from 'react';

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  getContract,
  PublicClient,
  WalletClient,
} from 'viem';

import { hardhat } from 'viem/chains';

// All the logic of this dapp is contained in the Dapp component.
// These other components are just presentational ones: they don't have any
// logic. They just render HTML.
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Loading } from "./Loading";
import { Transfer } from "./Transfer";
import { TransactionErrorMessage } from "./TransactionErrorMessage";
import { WaitingForTransactionMessage } from "./WaitingForTransactionMessage";
import { NoTokensMessage } from "./NoTokensMessage";

// Define window.ethereum type for MetaMask
declare global {
  interface Window {
    ethereum?: import('viem').EIP1193Provider;
  }
}

// Constants
const JSON_RPC_URL = 'http://127.0.0.1:8545';
const HARDHAT_NETWORK_ID = '31337'; // Hardhat default network ID
const ERROR_CODE_TX_REJECTED_BY_USER = 4001;

// load contract ABIs and deployed addresses
async function loadTokenABI() {
    const response = await fetch("/TokenModule_Token.json");
    return response.json();
}

const TokenArtifact = await loadTokenABI();

async function loadAddresses() {
    const response = await fetch("/deployed_addresses.json");
    return response.json();
}

const deployedAddresses = await loadAddresses();

// Type definitions for state
interface TokenData {
  name: string;
  symbol: string;
}

interface DappState {
  tokenData?: TokenData;
  selectedAddress?: string;
  balance?: bigint;
  txBeingSent?: string;
  transactionError?: any; // Error type could be refined further
  networkError?: string;
}

// Type for Transfer component props (assumed from usage)
interface TransferProps {
  transferTokens: (to: string, amount: string) => void;
  tokenSymbol: string;
}

export class Dapp extends Component<{}, DappState> {
  private _publicClient?: PublicClient;
  private _walletClient?: WalletClient;
  private _tokenContract?: ReturnType<typeof getContract>;
  private _pollDataInterval?: NodeJS.Timeout;

  constructor(props: {}) {
    super(props);

    this.initialState = {
      tokenData: undefined,
      selectedAddress: undefined,
      balance: undefined,
      txBeingSent: undefined,
      transactionError: undefined,
      networkError: undefined,
    };

    this.state = this.initialState;
  }

  render() {
    if (window.ethereum === undefined) {
      return <NoWalletDetected />;
    }

    if (!this.state.selectedAddress) {
      return (
        <ConnectWallet
          connectWallet={() => this._connectWallet()}
          networkError={this.state.networkError}
          dismiss={() => this._dismissNetworkError()}
        />
      );
    }

    if (!this.state.tokenData || this.state.balance === undefined) {
      return <Loading />;
    }

    return (
      <div className="container p-4">
        <div className="row">
          <div className="col-12">
            <h1>
              {this.state.tokenData.name} ({this.state.tokenData.symbol})
            </h1>
            <p>
              Welcome <b>{this.state.selectedAddress}</b>, you have{' '}
              <b>
                {this.state.balance.toString()} {this.state.tokenData.symbol}
              </b>
              .
            </p>
          </div>
        </div>

        <hr />

        <div className="row">
          <div className="col-12">
            {this.state.txBeingSent && (
              <WaitingForTransactionMessage txHash={this.state.txBeingSent} />
            )}
            {this.state.transactionError && (
              <TransactionErrorMessage
                message={this._getRpcErrorMessage(this.state.transactionError)}
                dismiss={() => this._dismissTransactionError()}
              />
            )}
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            {this.state.balance === BigInt(0) && (
              <NoTokensMessage selectedAddress={this.state.selectedAddress} />
            )}
            {this.state.balance > BigInt(0) && (
              <Transfer
                transferTokens={(to, amount) => this._transferTokens(to, amount)}
                tokenSymbol={this.state.tokenData.symbol}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  componentWillUnmount() {
    this._stopPollingData();
  }

  private async _connectWallet() {
    try {
      if (!window.ethereum) throw new Error('MetaMask is not installed');

      const [selectedAddress] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      this.setState({ selectedAddress });

      await this._checkNetwork();
      await this._initialize();

      window.ethereum.on('accountsChanged', ([newAddress]: string[]) => {
        this._stopPollingData();
        if (newAddress === undefined) return this._resetState();
        this.setState({ selectedAddress: newAddress }, () => this._initialize());
      });

      window.ethereum.on('chainChanged', () => {
        this._checkNetwork();
      });
    } catch (error) {
      console.error(error);
      this.setState({ networkError: (error as Error).message });
    }
  }

  private async _initialize() {
    try {
      const tokenAddress = deployedAddresses["TokenModule#Token"];
      this._initializeViem(TokenArtifact, tokenAddress);
      await this._getTokenData();
      this._startPollingData();
    } catch (error) {
      console.error('Initialization Error:', error);
      this.setState({ networkError: (error as Error).message });
    }
  }

  private _initializeViem(tokenAbi: any, tokenAddress: string) {    // Public client for reading data
    this._publicClient = createPublicClient({
      chain: hardhat,
      transport: window.ethereum ? custom(window.ethereum) : http(JSON_RPC_URL),
    });

    // Initialize WalletClient with the selected address
    this._walletClient = createWalletClient({
      chain: hardhat,
      transport: window.ethereum ? custom(window.ethereum) : http(JSON_RPC_URL),
      account: this.state.selectedAddress as `0x${string}`, // Use connected MetaMask account
    });

    // Token contract instance
    this._tokenContract = getContract({
      address: deployedAddresses["TokenModule#Token"] as `0x${string}`,
      abi: TokenArtifact.abi,
      client: { public: this._publicClient, wallet: this._walletClient },
    });
  }

  private _startPollingData() {
    this._pollDataInterval = setInterval(() => this._updateBalance(), 1000);
    this._updateBalance();
  }

  private _stopPollingData() {
    if (this._pollDataInterval) {
      clearInterval(this._pollDataInterval);
      this._pollDataInterval = undefined;
    }
  }

  private async _getTokenData() {
    if (!this._tokenContract) return;
    const name = (await this._tokenContract.read.name()) as string;
    const symbol = (await this._tokenContract.read.symbol()) as string;
    this.setState({ tokenData: { name, symbol } });
  }

  private async _updateBalance() {
    if (!this._tokenContract || !this.state.selectedAddress) return;
    const balance = (await this._tokenContract.read.balanceOf([
      this.state.selectedAddress,
    ])) as bigint;
    this.setState({ balance });
  }

  private async _transferTokens(to: string, amount: string) {
    if (!this._tokenContract || !this._walletClient) return;

    try {
      this._dismissTransactionError();
      const amountBigInt = BigInt(amount);
      const txHash = await this._tokenContract.write.transfer([to, amountBigInt]);
      this.setState({ txBeingSent: txHash });

      const receipt = await this._publicClient!.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction failed');
      }

      await this._updateBalance();
    } catch (error: any) {
      if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
        return;
      }
      console.error(error);
      this.setState({ transactionError: error });
    } finally {
      this.setState({ txBeingSent: undefined });
    }
  }

  private _dismissTransactionError() {
    this.setState({ transactionError: undefined });
  }

  private _dismissNetworkError() {
    this.setState({ networkError: undefined });
  }

  private _getRpcErrorMessage(error: any): string {
    return error.data?.message || error.message;
  }

  private _resetState() {
    this.setState(this.initialState);
  }

  private async _switchChain() {
    const chainIdHex = `0x${parseInt(HARDHAT_NETWORK_ID, 10).toString(16)}`;
    await window.ethereum!.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
    if (this.state.selectedAddress) {
      await this._initialize(this.state.selectedAddress);
    }
  }

  private async _checkNetwork() {
    const currentChainId = Number(
      await window.ethereum!.request({ method: 'eth_chainId' })
    ).toString();

    if (currentChainId !== HARDHAT_NETWORK_ID) {
      await this._switchChain();
    }
  }
}