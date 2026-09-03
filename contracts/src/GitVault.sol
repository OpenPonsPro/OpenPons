// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * Every repo's treasury, in one contract.
 *
 * ⭐⭐ THE ID IS THE REPO. `projectId` is the `owner/repo` slug itself in a bytes32 (hashed only
 * past 32 bytes — see `web/src/lib/projects.ts`), so a balance here is legible off any explorer
 * with no directory and no us.
 *
 * ⛔ NOTHING LEAVES EXCEPT THROUGH `claim`. No withdraw, no pause, no sweep, no rescue. The one
 * admin surface is rotating the claim signer, and that is timelocked and public.
 *
 * ⚠ There is deliberately no `receive()`: a plain send reverts, because money that arrives
 * without a `projectId` is money nobody can ever claim. Attribution is the entry fee.
 */
contract GitVault is EIP712 {
    using SafeERC20 for IERC20;

    /// asset address(0) is native ETH.
    mapping(bytes32 => mapping(address => uint256)) public balances;
    /// Lifetime figure, never decremented: the chain's public log window is minutes, so history
    /// must be one eth_call away — the same reason the launchpad keeps an on-chain register.
    mapping(bytes32 => mapping(address => uint256)) public totalDeposited;

    address public claimSigner;
    address public immutable owner;

    event Deposited(bytes32 indexed projectId, address indexed asset, uint256 amount, address indexed from);

    error ZeroAmount();
    error ZeroAddress();

    constructor(address claimSigner_, address owner_) EIP712("GitVault", "1") {
        if (claimSigner_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        claimSigner = claimSigner_;
        owner = owner_;
    }

    function deposit(bytes32 projectId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        balances[projectId][address(0)] += msg.value;
        totalDeposited[projectId][address(0)] += msg.value;
        emit Deposited(projectId, address(0), msg.value, msg.sender);
    }

    function depositToken(bytes32 projectId, address asset, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        balances[projectId][asset] += amount;
        totalDeposited[projectId][asset] += amount;
        emit Deposited(projectId, asset, amount, msg.sender);
    }

    /* ------------------------------------------------------------------- claim -- */

    mapping(bytes32 => uint256) public nonces;

    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 projectId,address to,address[] assets,uint256 nonce,uint256 deadline)");

    event Claimed(bytes32 indexed projectId, address indexed to, address indexed asset, uint256 amount);

    error Expired();
    error BadNonce();
    error BadSignature();
    error TransferFailed();

    /// Exposed so tests and the verifier build the exact digest this contract checks.
    function domainSeparator() external view returns (bytes32) { return _domainSeparatorV4(); }

    /**
     * 100% of every listed asset, or nothing. Partial amounts would be a discretion this design
     * refuses; how a project divides the money afterwards is the project's business.
     */
    function claim(
        bytes32 projectId,
        address to,
        address[] calldata assets,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (nonce != nonces[projectId]) revert BadNonce();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            CLAIM_TYPEHASH, projectId, to, keccak256(abi.encodePacked(assets)), nonce, deadline
        )));
        if (ECDSA.recover(digest, signature) != claimSigner) revert BadSignature();
        nonces[projectId] = nonce + 1;

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amount = balances[projectId][assets[i]];
            /* ⭐ Skipped, not reverted: a signature must not go stale because a balance emptied
               between signing and mining. */
            if (amount == 0) continue;
            balances[projectId][assets[i]] = 0;
            if (assets[i] == address(0)) {
                (bool ok,) = to.call{value: amount}("");
                if (!ok) revert TransferFailed();
            } else {
                IERC20(assets[i]).safeTransfer(to, amount);
            }
            emit Claimed(projectId, to, assets[i], amount);
        }
    }

    /* ---------------------------------------------------------------- rotation -- */

    uint64 public constant ROTATION_DELAY = 48 hours;
    address public pendingSigner;
    uint64 public signerEffectiveAt;

    event SignerAnnounced(address next, uint64 effectiveAt);
    event SignerRotated(address old, address next);

    error NotOwner();
    error NothingPending();
    error TooEarly();

    /**
     * The ONLY admin surface. A lost verifier key costs at most 48 hours of claims; a hostile
     * owner must announce themselves two days before they can sign anything, on a public event.
     */
    function announceSigner(address next) external {
        if (msg.sender != owner) revert NotOwner();
        if (next == address(0)) revert ZeroAddress();
        pendingSigner = next;
        signerEffectiveAt = uint64(block.timestamp) + ROTATION_DELAY;
        emit SignerAnnounced(next, signerEffectiveAt);
    }

    /// Anyone may apply once the delay has passed — the announcement is the permission.
    function applySigner() external {
        if (pendingSigner == address(0)) revert NothingPending();
        if (block.timestamp < signerEffectiveAt) revert TooEarly();
        emit SignerRotated(claimSigner, pendingSigner);
        claimSigner = pendingSigner;
        pendingSigner = address(0);
    }
}
