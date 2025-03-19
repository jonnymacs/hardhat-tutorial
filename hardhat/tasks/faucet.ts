import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createPublicClient, createWalletClient, http, getContract, parseEther } from "viem";
import { hardhat } from "viem/chains";
import TokenArtifact from "../artifacts/contracts/Token.sol/Token.json";
import deployedAddresses from "../ignition/deployments/chain-31337/deployed_addresses.json";

task("faucet", "Sends ETH and tokens to an address")
  .addPositionalParam("receiver", "The address that will receive them")
  .setAction(async ({ receiver }: { receiver: string }, hre: HardhatRuntimeEnvironment) => {
    // Warn if using in-memory Hardhat network
    if (hre.network.name === "hardhat") {
      console.warn(
        "You are running the faucet task with Hardhat network, which " +
          "gets automatically created and destroyed every time. Use the Hardhat " +
          "option '--network localhost'"
      );
    }

    const address = deployedAddresses["TokenModule#Token"] as `0x${string}`;

    if (!address) {
      console.error("Contract address not found in deployedAddresses");
      return;
    }

    // Set up Viem clients
    const publicClient = createPublicClient({
      chain: hardhat,
      transport: http("http://127.0.0.1:8545"),
    });

    const walletClient = createWalletClient({
      chain: hardhat,
      transport: http("http://127.0.0.1:8545"),
      account: (await hre.viem.getWalletClients())[0].account, // First Hardhat account
    });

    // Check if contract is deployed
    const code = await publicClient.getCode({ address: address });
    if (!code || code === "0x") {
      console.error("You need to deploy your contract first");
      return;
    }

    //const TokenArtifact = await loadTokenABI();
    // Get token contract instance
    const token = getContract({
      address: address,
      abi: TokenArtifact.abi,
      client: { public: publicClient, wallet: walletClient },
    });

    // Transfer 100 tokens
    const tokenTxHash = await token.write.transfer([receiver as `0x${string}`, BigInt(100)]);
    await publicClient.waitForTransactionReceipt({ hash: tokenTxHash });
    console.log(`Transferred 100 tokens to ${receiver}`);

    // Transfer 1 ETH
    const ethTxHash = await walletClient.sendTransaction({
      to: receiver as `0x${string}`,
      value: parseEther("1"), // 1 ETH in wei
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log(`Transferred 1 ETH to ${receiver}`);

    console.log(`Successfully transferred 1 ETH and 100 tokens to ${receiver}`);
  });