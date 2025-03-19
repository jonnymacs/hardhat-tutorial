import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
};

import "./tasks/faucet"

export default config;

import dotenv from 'dotenv';
dotenv.config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    // for testnet
    'avalanche_testnet': {
        url: "https://api.avax-test.network/ext/bc/C/rpc",
        chainId: 43113,
        accounts: [process.env.WALLET_KEY],
    }
  }
}