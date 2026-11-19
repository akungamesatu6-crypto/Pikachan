// PikaCHAN deploy SIMULATION ONLY — no mainnet transaction is sent by this script.
// Computes CREATE2 predicted addresses exactly as the deterministic-proxy
// route did for HATCHIEggy/Woof Agent/Eye Agent, and measures gas on the
// local network.
// Deploy order: PIKA token first (constructor: owner only), then the
// PikaCHAN NFT (constructor: baseURI, owner, Agent ID registry, predicted
// PIKA address — the token deploys first, so its address is known), then
// the PikaChanMarketplace (constructor: predicted NFT address).
// After deploy the owner must call token.setMinter(nft). Mint stays CLOSED
// (mintOpen=false in the constructor) until the owner calls
// setMintOpen(true) — that opening step is a separate owner call, and per
// the launch sequence it happens only after preparations are done.
// Spec: supply 1,111, random deck-draw ids 1-1111, #1 FREE via Agent ID
// (SPACE ID registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F), paid flat
// 0.001 BNB, 5-pack 0.005 BNB, max 6/wallet, FREE CAP 1,000 total,
// 120,000 PIKA per paid mint, max 600,000 PIKA/wallet, game bonus 1,000
// PIKA/milestone max 100, royalty 5% to BAW.
// Planned baseURI: https://pikachan.vercel.app/metadata/
// Run: npx hardhat run scripts/deploy_simulation.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BASE_URI = "https://pikachan.vercel.app/metadata/";
const OWNER = "0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2"; // BAW
const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID
const PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"; // Arachnid deterministic proxy
// Canonical deterministic-deployment-proxy creation code (deploys the proxy
// itself; used here only on the local network so the CREATE2 call can be
// gas-estimated with identical bytecode).
const PROXY_CREATION =
  "0x604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

function predict(artifact, argTypes, argValues) {
  const args = ethers.AbiCoder.defaultAbiCoder().encode(argTypes, argValues);
  const creation = artifact.bytecode + args.slice(2);
  const predicted = ethers.getCreate2Address(PROXY, ethers.ZeroHash, ethers.keccak256(creation));
  return { creation, predicted };
}

async function estimateViaProxy(signer, inputData) {
  const proxyDeployTx = await signer.sendTransaction({ data: PROXY_CREATION });
  const proxyReceipt = await proxyDeployTx.wait();
  const localProxy = proxyReceipt.contractAddress;
  const gasViaProxy = await ethers.provider.estimateGas({ to: localProxy, data: inputData });
  return { localProxy, gasViaProxy };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const gasPriceWei = 50_000_000n; // 0.05 gwei, as measured on BSC
  const outDir = __dirname + "/..";
  const results = {};

  // 1) PIKA token — constructor(address owner_)
  const tokenArtifact = await hre.artifacts.readArtifact("PikaToken");
  const token = predict(tokenArtifact, ["address"], [OWNER]);
  const tokenInput = ethers.concat([ethers.ZeroHash, token.creation]);
  const tokenEst = await estimateViaProxy(signer, tokenInput);
  fs.writeFileSync(path.join(outDir, "token_creation.txt"), token.creation);
  fs.writeFileSync(path.join(outDir, "token_inputdata.txt"), ethers.hexlify(tokenInput));
  fs.writeFileSync(path.join(outDir, "token_predicted.txt"), token.predicted);
  results.token = {
    predicted: token.predicted,
    gasViaProxy: tokenEst.gasViaProxy.toString(),
    costBnb: Number(tokenEst.gasViaProxy * gasPriceWei) / 1e18,
  };

  // 2) PikaCHAN NFT — constructor(string baseURI, address owner, address agentIdRegistry, address token)
  const nftArtifact = await hre.artifacts.readArtifact("PikaChanNft");
  const nft = predict(
    nftArtifact,
    ["string", "address", "address", "address"],
    [BASE_URI, OWNER, AGENT_ID_REGISTRY, token.predicted]
  );
  const nftInput = ethers.concat([ethers.ZeroHash, nft.creation]);
  const nftEst = await estimateViaProxy(signer, nftInput);
  fs.writeFileSync(path.join(outDir, "nft_creation.txt"), nft.creation);
  fs.writeFileSync(path.join(outDir, "nft_inputdata.txt"), ethers.hexlify(nftInput));
  fs.writeFileSync(path.join(outDir, "nft_predicted.txt"), nft.predicted);
  results.nft = {
    predicted: nft.predicted,
    gasViaProxy: nftEst.gasViaProxy.toString(),
    costBnb: Number(nftEst.gasViaProxy * gasPriceWei) / 1e18,
  };

  // 3) Marketplace — constructor(address nft_)
  const marketArtifact = await hre.artifacts.readArtifact("PikaChanMarketplace");
  const market = predict(marketArtifact, ["address"], [nft.predicted]);
  const marketInput = ethers.concat([ethers.ZeroHash, market.creation]);
  const marketEst = await estimateViaProxy(signer, marketInput);
  fs.writeFileSync(path.join(outDir, "market_creation.txt"), market.creation);
  fs.writeFileSync(path.join(outDir, "market_inputdata.txt"), ethers.hexlify(marketInput));
  fs.writeFileSync(path.join(outDir, "market_predicted.txt"), market.predicted);
  results.market = {
    predicted: market.predicted,
    gasViaProxy: marketEst.gasViaProxy.toString(),
    costBnb: Number(marketEst.gasViaProxy * gasPriceWei) / 1e18,
  };

  results.proxy = PROXY;
  results.salt = ethers.ZeroHash;
  results.baseURI = BASE_URI;
  results.owner = OWNER;
  results.agentIdRegistry = AGENT_ID_REGISTRY;
  results.totalCostBnb =
    results.token.costBnb + results.nft.costBnb + results.market.costBnb;
  results.note =
    "SIMULATION ONLY — nothing deployed to mainnet. Gas estimated on local Hardhat network with identical proxy bytecode. After deploy: token.setMinter(nft), then owner setMintOpen(true) only when ordered.";
  fs.writeFileSync(path.join(outDir, "deploy_simulation.json"), JSON.stringify(results, null, 2));

  console.log("PIKA token predicted:  ", results.token.predicted, "| gas:", results.token.gasViaProxy, "| cost:", results.token.costBnb, "BNB");
  console.log("PikaCHAN NFT pred.:   ", results.nft.predicted, "| gas:", results.nft.gasViaProxy, "| cost:", results.nft.costBnb, "BNB");
  console.log("Marketplace predicted:", results.market.predicted, "| gas:", results.market.gasViaProxy, "| cost:", results.market.costBnb, "BNB");
  console.log("Total est. cost @0.05 gwei:", results.totalCostBnb, "BNB");
  console.log("Files written: token/nft/market *_creation.txt, *_inputdata.txt, *_predicted.txt, deploy_simulation.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
