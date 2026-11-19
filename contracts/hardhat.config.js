require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    hardhat: {
      // 1,200 funded local accounts: the free-cap / full-drain tests mint
      // from 1,000+ distinct wallets.
      accounts: { count: 1200 },
    },
    bscMainnet: {
      url: "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
