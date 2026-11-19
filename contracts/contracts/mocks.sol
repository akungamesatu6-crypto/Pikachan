// SPDX-License-Identifier: MIT
// Test mocks for PikaCHAN.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Stand-in for the SPACE ID Agent ID registry (real address on
/// BSC mainnet: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F). Tests flip
/// Agent ID possession per wallet, or allow all wallets at once (used by
/// the 1,000-wallet free-cap drain test).
contract MockAgentIdRegistry {
    mapping(address => bool) public hasId;
    bool public allowAll;

    function setHasId(address wallet, bool value) external {
        hasId[wallet] = value;
    }

    function setAllowAll(bool value) external {
        allowAll = value;
    }

    function balanceOf(address wallet) external view returns (uint256) {
        return (allowAll || hasId[wallet]) ? 1 : 0;
    }
}

/// @notice A contract that tries to mint — must be rejected by the EOA
/// gate (NotAgent) on mintFree.
contract MockMinter {
    address public immutable nft;

    constructor(address nft_) {
        nft = nft_;
    }

    function tryMintFree() external {
        (bool ok, bytes memory ret) = nft.call(abi.encodeWithSignature("mintFree()"));
        if (!ok) {
            // Bubble the revert up so the test sees the original error.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

/// @notice Plain ERC-721 with NO royalty support — the marketplace must
/// fall back to its hardcoded 5% to the owner wallet.
contract MockERC721NoRoyalty is ERC721 {
    constructor() ERC721("Mock Pika", "MOCK") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}
