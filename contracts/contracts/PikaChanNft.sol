// SPDX-License-Identifier: MIT
// PikaCHAN — agent-gated random-draw NFT collection on BNB Chain.
// Spec (locked 2026-11-19):
//   Supply 1,111, RANDOM token ids (swap-and-pop pools, NOT VRF).
//   Rarity by token id (in metadata — 17 original characters):
//   Common 1-555 / Uncommon 556-833 / Rare 834-999 / Epic 1000-1088 /
//   Legendary 1089-1110 / Limited 1111 (1-of-1 Golden Voltmouse).
//   THREE LANES (Sakura model, rescaled):
//   - FREE lane: mintFree(), Agent ID ONLY (msg.sender == tx.origin +
//     SPACE ID Agent ID registry balance > 0, NO allowlist). 1 free per
//     wallet, price 0, accrues 0 PIKA. Free draws ONLY from ids 1-1000.
//     FREE CAP 1,000 total: once 1,000 free mints are claimed (regular
//     free + game free mints combined), no more free — ever.
//   - PAID lane: mintPaid(qty), PUBLIC — any wallet, no agent gate.
//     qty 1-4: 0.001 BNB each, draws from the combined pool of ids
//     1-1110. qty 5 (5-pack): 0.005 BNB flat, draws from the combined
//     pool of ids 1-1110 PLUS Limited 1111 — the ONLY route that can
//     reach 1111. Chance, not guaranteed. Max 5 paid per wallet.
//     Each paid mint accrues 120,000 PIKA (max 600,000/wallet).
//   - GAME lane: claimGameFreeMint(), 1 EXTRA free mint per 10 game
//     milestones the wallet has already claimed on the PIKA token
//     (token.gameMilestonesClaimed(wallet) >= 10 * (gameFreeMinted+1)),
//     max 2 per wallet. Draws from the free pool (ids 1-1000) and counts
//     toward the FREE CAP 1,000 + freeMinted. It does NOT count toward
//     the 6-per-wallet regular cap (it is an EXTRA reward on top of the
//     1 free + 5 paid); it has no Agent ID gate — the only gate is the
//     milestone requirement itself.
//   Total regular cap 6 per wallet (1 free + 5 paid). Free and paid can
//   be claimed in any order: a wallet may mint paid first and claim the
//   free later, and vice versa.
//   Mint money: forwarded to the owner (BAW) in the same tx; the
//   contract does not hold mint revenue. Exact payment only — underpay
//   AND overpay both revert WrongValue (no refunds).
//   Royalty 5% (ERC-2981) to the owner (BAW). Owner can ONLY: open/
//   close mint, set base URI, withdraw stuck funds. Prices, supply and
//   limits are immutable after deploy.
//   baseURI: https://pikachan.vercel.app/metadata/
//   THE POOLS — why free and paid share ids 1-1000 without double-mint:
//   The free pool (1-1000) and the paid pool (1001-1110) are DISJOINT.
//   A paid single draws from the UNION of the two pools, weighted by
//   what remains in each — so a paid draw that lands in 1-1000 removes
//   that id from the free pool, and a free draw removes it from the
//   paid-single pool. No id can ever be minted twice. A 5-pack draws
//   from the union of both pools PLUS Limited 1111 (one extra slot
//   while it is still unminted).
//   KNOWN ENDGAME PROPERTY (spec as written): Limited 1111 can ONLY be
//   drawn by a 5-pack, and a 5-pack always draws exactly 5 tokens. If
//   the collection ever reaches a state where fewer than 5 tokens
//   remain and 1111 is among them (e.g. nobody ever buys a 5-pack and
//   the last token left is 1111), 1111 becomes unmintable and the
//   collection caps at 1,110 minted. This is covered by a test
//   (drain test) and flagged in the build report — it is a property of
//   the locked spec, not a bug in this implementation.
//   THE DRAW is deterministic pseudo-randomness (blockhash + timestamp +
//   sender + draw counter) — it is NOT VRF / provably fair; anyone who
//   knows the inputs can compute the draw in advance.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IPikaToken {
    function accrue(address wallet, uint256 amount) external;
    function gameMilestonesClaimed(address wallet) external view returns (uint256);
}

/// @title PikaCHAN
contract PikaChanNft is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;

    IPikaToken public immutable TOKEN;
    address public immutable agentIdRegistry;

    uint256 public constant MAX_SUPPLY = 1111;
    uint256 public constant PRICE = 0.001 ether; // flat per paid mint
    uint256 public constant PRICE_PACK_5 = 0.005 ether; // 5 at once
    uint256 public constant MAX_PER_WALLET = 6; // 1 free + 5 paid (regular mints)
    uint256 public constant MAX_PAID_PER_WALLET = 5;
    uint256 public constant FREE_CAP = 1000; // total free mints, ever (regular + game)
    uint256 public constant BONUS_PER_PAID_MINT = 120_000 ether;
    uint256 public constant MAX_GAME_FREE_PER_WALLET = 2;
    uint256 public constant MILESTONES_PER_GAME_FREE_MINT = 10;
    uint256 public constant LIMITED_ID = 1111;

    // Draw pools (swap-and-pop, lazy identity mapping — Sakura pattern).
    // Free pool: ids 1-1000. Paid pool: ids 1001-1110. Limited: id 1111.
    uint256 public constant FREE_POOL_SIZE = 1000;
    uint256 public constant PAID_POOL_SIZE = 110;

    uint256 public totalMinted;
    uint256 public paidMinted;
    uint256 public freeMinted; // regular free + game free, capped at FREE_CAP
    bool public mintOpen;
    string private _base;

    uint256 private _freeRemaining = FREE_POOL_SIZE;
    uint256 private _paidRemaining = PAID_POOL_SIZE;
    bool private _limitedMinted;
    mapping(uint256 => uint256) private _freeAtIndex; // 0 = identity (id = index + 1)
    mapping(uint256 => uint256) private _paidAtIndex; // 0 = identity (id = 1001 + index)
    /// @dev Global draw counter: seeds every draw so no two draws share
    /// a seed, even inside one bulk mint.
    uint256 private _draws;

    mapping(address => bool) public freeClaimed;
    mapping(address => uint256) public mintedOf; // regular mints (free + paid)
    mapping(address => uint256) public paidMintedOf;
    mapping(address => uint256) public gameFreeMinted;

    event Minted(address indexed minter, uint256 indexed id, bool paid, uint256 priceWei);

    error NotAgent();
    error NoAgentId();
    error MintClosed();
    error SoldOut();
    error OverLimit();
    error WrongValue(uint256 required);
    error FreeClaimed();
    error FreeCapReached();
    error InsufficientMilestones();
    error InvalidAddress();

    constructor(
        string memory baseURI_,
        address owner_,
        address agentIdRegistry_,
        address token_
    ) ERC721("PikaCHAN", "PIKA") Ownable(owner_) {
        if (owner_ == address(0) || agentIdRegistry_ == address(0) || token_ == address(0)) {
            revert InvalidAddress();
        }
        _base = baseURI_;
        agentIdRegistry = agentIdRegistry_;
        TOKEN = IPikaToken(token_);
        mintOpen = false; // mint starts CLOSED until owner opens it
        _setDefaultRoyalty(owner_, 500); // 5%
    }

    // ---------- supply / pricing / pools (read-only, for UI + agents) ----------

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function exists(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0);
    }

    /// @notice Undrawn ids left in the free pool (1-1000).
    function freeRemaining() external view returns (uint256) {
        return _freeRemaining;
    }

    /// @notice Undrawn ids left in the paid pool (1001-1110).
    function paidRemaining() external view returns (uint256) {
        return _paidRemaining;
    }

    /// @notice True while Limited 1111 is still unminted.
    function limitedAvailable() external view returns (bool) {
        return !_limitedMinted;
    }

    /// @notice True while Limited 1111 is still in the 5-pack pool.
    /// Deterministic proof (no randomness needed) that a 5-pack CAN
    /// reach 1111 — the draw itself is a chance, not a guarantee.
    function fivePackPoolIncludesLimited() external view returns (bool) {
        return !_limitedMinted;
    }

    /// @notice True when `wallet` holds at least one SPACE ID Agent ID
    /// NFT in the registry. A registry that does not answer like an
    /// ERC-721 returns false instead of reverting (low-level staticcall
    /// on purpose — SnakeAgentNFT pattern).
    function holdsAgentId(address wallet) public view returns (bool) {
        if (agentIdRegistry == address(0)) return false;
        (bool ok, bytes memory data) = agentIdRegistry.staticcall(
            abi.encodeWithSelector(IERC721.balanceOf.selector, wallet)
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (uint256)) > 0;
    }

    /// @notice Exact BNB cost of `qty` further PAID mints by `wallet`.
    /// Singles: qty x 0.001 BNB. A 5-at-once purchase: 0.005 BNB flat.
    function priceFor(address wallet, uint256 qty) public view returns (uint256) {
        if (qty == 0 || qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (paidMintedOf[wallet] + qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (mintedOf[wallet] + qty > MAX_PER_WALLET) revert OverLimit();
        if (qty == 5) {
            uint256 packPool = _freeRemaining + _paidRemaining + (_limitedMinted ? 0 : 1);
            if (packPool < 5) revert SoldOut();
            return PRICE_PACK_5;
        }
        if (_freeRemaining + _paidRemaining < qty) revert SoldOut();
        return PRICE * qty;
    }

    // ---------- the draw (swap-and-pop, Sakura pattern) ----------

    /// @dev Draw seed: blockhash + timestamp + sender + global draw
    /// counter. Deterministic pseudo-randomness, NOT VRF.
    function _seed() internal view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(blockhash(block.number - 1), block.timestamp, msg.sender, _draws)
            )
        );
    }

    /// @dev Draw one token id from a pool (swap-and-pop). `pool` holds
    /// index -> token id overrides; 0 means identity (base + index).
    /// Caller must decrement the pool's remaining counter afterwards.
    function _drawFrom(
        mapping(uint256 => uint256) storage pool,
        uint256 remaining,
        uint256 index,
        uint256 base
    ) internal returns (uint256) {
        uint256 tokenId = pool[index] == 0 ? base + index : pool[index];
        uint256 lastIndex = remaining - 1;
        uint256 lastTokenId = pool[lastIndex] == 0 ? base + lastIndex : pool[lastIndex];
        pool[index] = lastTokenId;
        return tokenId;
    }

    /// @dev Draw one id from the free pool only (ids 1-1000).
    function _drawFree() internal returns (uint256) {
        if (_freeRemaining == 0) revert SoldOut();
        uint256 id = _drawFrom(_freeAtIndex, _freeRemaining, _seed() % _freeRemaining, 1);
        _freeRemaining -= 1;
        _draws++;
        return id;
    }

    /// @dev Draw one id from the combined free + paid pools (ids 1-1110),
    /// weighted by what remains in each. Never returns 1111.
    function _drawPaidSingle() internal returns (uint256) {
        uint256 total = _freeRemaining + _paidRemaining;
        if (total == 0) revert SoldOut();
        uint256 r = _seed() % total;
        uint256 id;
        if (r < _freeRemaining) {
            id = _drawFrom(_freeAtIndex, _freeRemaining, r, 1);
            _freeRemaining -= 1;
        } else {
            uint256 idx = r - _freeRemaining;
            id = _drawFrom(_paidAtIndex, _paidRemaining, idx, 1001);
            _paidRemaining -= 1;
        }
        _draws++;
        return id;
    }

    /// @dev Draw one id from the combined free + paid pools PLUS Limited
    /// 1111 (5-pack only), weighted by what remains in each. This is the
    /// ONLY draw that can return 1111.
    function _drawPaidPack() internal returns (uint256) {
        uint256 total = _freeRemaining + _paidRemaining + (_limitedMinted ? 0 : 1);
        if (total == 0) revert SoldOut();
        uint256 r = _seed() % total;
        uint256 id;
        if (r < _freeRemaining) {
            id = _drawFrom(_freeAtIndex, _freeRemaining, r, 1);
            _freeRemaining -= 1;
        } else if (r < _freeRemaining + _paidRemaining) {
            uint256 idx = r - _freeRemaining;
            id = _drawFrom(_paidAtIndex, _paidRemaining, idx, 1001);
            _paidRemaining -= 1;
        } else {
            id = LIMITED_ID;
            _limitedMinted = true;
        }
        _draws++;
        return id;
    }

    function _mintDrawn(address to, uint256 id, bool paid, uint256 priceWei) internal {
        totalMinted++;
        if (paid) paidMinted++;
        _safeMint(to, id);
        emit Minted(to, id, paid, priceWei);
    }

    // ---------- minting ----------

    /// @notice FREE lane: the wallet's one free PikaCHAN (ids 1-1000).
    /// Agent ID ONLY (EOA + SPACE ID registry), no allowlist.
    function mintFree() external nonReentrant {
        if (msg.sender != tx.origin) revert NotAgent();
        if (!holdsAgentId(msg.sender)) revert NoAgentId();
        if (!mintOpen) revert MintClosed();
        if (freeClaimed[msg.sender]) revert FreeClaimed();
        if (freeMinted >= FREE_CAP) revert FreeCapReached();
        if (totalMinted + 1 > MAX_SUPPLY) revert SoldOut();
        uint256 id = _drawFree();
        freeClaimed[msg.sender] = true;
        freeMinted++;
        mintedOf[msg.sender]++;
        _mintDrawn(msg.sender, id, false, 0);
    }

    /// @notice PAID lane: mint `qty` PikaCHAN. PUBLIC — any wallet.
    /// qty 1-4: 0.001 BNB each, draws from ids 1-1110 (never 1111).
    /// qty 5: 0.005 BNB total, draws from ids 1-1110 + Limited 1111.
    /// Each paid mint accrues 120,000 PIKA. Exact payment only.
    function mintPaid(uint256 qty) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (qty == 0 || qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (paidMintedOf[msg.sender] + qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (mintedOf[msg.sender] + qty > MAX_PER_WALLET) revert OverLimit();
        if (totalMinted + qty > MAX_SUPPLY) revert SoldOut();
        uint256 cost = priceFor(msg.sender, qty);
        if (msg.value != cost) revert WrongValue(cost);
        bool pack = qty == 5;

        for (uint256 i; i < qty; i++) {
            uint256 id = pack ? _drawPaidPack() : _drawPaidSingle();
            _mintDrawn(msg.sender, id, true, pack ? PRICE_PACK_5 / 5 : PRICE);
        }
        paidMintedOf[msg.sender] += qty;
        mintedOf[msg.sender] += qty;

        TOKEN.accrue(msg.sender, BONUS_PER_PAID_MINT * qty);

        // Mint money goes straight to the owner (BAW) in the same tx.
        if (cost > 0) {
            (bool ok, ) = owner().call{value: cost}("");
            require(ok, "forward");
        }
    }

    /// @notice GAME lane: 1 EXTRA free mint per 10 game milestones the
    /// wallet has claimed on the PIKA token, max 2 per wallet. Draws
    /// from the free pool (ids 1-1000) and counts toward the FREE CAP
    /// 1,000 + freeMinted. Does NOT count toward the 6-per-wallet
    /// regular cap. No Agent ID gate — the milestone requirement is the
    /// only gate.
    function claimGameFreeMint() external nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (gameFreeMinted[msg.sender] >= MAX_GAME_FREE_PER_WALLET) revert OverLimit();
        uint256 required = MILESTONES_PER_GAME_FREE_MINT * (gameFreeMinted[msg.sender] + 1);
        if (TOKEN.gameMilestonesClaimed(msg.sender) < required) revert InsufficientMilestones();
        if (freeMinted >= FREE_CAP) revert FreeCapReached();
        if (totalMinted + 1 > MAX_SUPPLY) revert SoldOut();
        uint256 id = _drawFree();
        gameFreeMinted[msg.sender]++;
        freeMinted++;
        _mintDrawn(msg.sender, id, false, 0);
    }

    /// @notice tokenURI = baseURI + tokenId (no .json suffix — same as
    /// Eye Agent / Sakura; baseURI ends with "/").
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(_base, Strings.toString(id));
    }

    // ── owner: only these switches exist ──
    function setMintOpen(bool v) external onlyOwner {
        mintOpen = v;
    }

    function setBaseURI(string calldata b) external onlyOwner {
        _base = b;
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "withdraw");
    }

    function supportsInterface(bytes4 i) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(i);
    }
}
