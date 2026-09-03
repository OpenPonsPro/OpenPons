// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {GitVault} from "../src/GitVault.sol";

contract Tok {
    string public constant symbol = "USDG";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v; balanceOf[to] += v; return true;
    }
    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[to] += v; return true;
    }
}

contract GitVaultTest is Test {
    GitVault v;
    Tok usdg;
    // ⚠ Anvil's first well-known key. Tests only; nothing real may ever use it.
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address signer;
    bytes32 constant PID = bytes32(bytes("vuejs/core"));

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        v = new GitVault(signer, address(this));
        usdg = new Tok();
    }

    function test_nativeDepositCreditsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit GitVault.Deposited(PID, address(0), 1 ether, address(this));
        v.deposit{value: 1 ether}(PID);
        assertEq(v.balances(PID, address(0)), 1 ether);
        assertEq(v.totalDeposited(PID, address(0)), 1 ether);
    }

    function test_zeroNativeDepositReverts() public {
        vm.expectRevert(GitVault.ZeroAmount.selector);
        v.deposit{value: 0}(PID);
    }

    function test_tokenDepositPullsViaAllowance() public {
        usdg.mint(address(this), 500e6);
        usdg.approve(address(v), 500e6);
        v.depositToken(PID, address(usdg), 500e6);
        assertEq(v.balances(PID, address(usdg)), 500e6);
        assertEq(usdg.balanceOf(address(v)), 500e6);
    }

    function test_zeroTokenDepositReverts() public {
        vm.expectRevert(GitVault.ZeroAmount.selector);
        v.depositToken(PID, address(usdg), 0);
    }

    function test_strangersMayDeposit() public {
        // ⭐ A donation from anyone is indistinguishable from a fee and just as claimable.
        vm.deal(address(0xBEEF), 1 ether);
        vm.prank(address(0xBEEF));
        v.deposit{value: 1 ether}(PID);
        assertEq(v.balances(PID, address(0)), 1 ether);
    }

    /* ------------------------------------------------------------------- claim -- */

    function _sign(bytes32 pid, address to, address[] memory assets, uint256 nonce, uint256 deadline)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Claim(bytes32 projectId,address to,address[] assets,uint256 nonce,uint256 deadline)"),
            pid, to, keccak256(abi.encodePacked(assets)), nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", v.domainSeparator(), structHash));
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, sv);
    }

    function _assets2() internal view returns (address[] memory a) {
        a = new address[](2);
        a[0] = address(0);
        a[1] = address(usdg);
    }

    function test_claimSweepsEveryListedAssetInFull() public {
        v.deposit{value: 2 ether}(PID);
        usdg.mint(address(this), 300e6);
        usdg.approve(address(v), 300e6);
        v.depositToken(PID, address(usdg), 300e6);

        address to = address(0xA11CE);
        bytes memory sig = _sign(PID, to, _assets2(), 0, block.timestamp + 900);
        v.claim(PID, to, _assets2(), 0, block.timestamp + 900, sig);

        assertEq(to.balance, 2 ether, "full native sweep");
        assertEq(usdg.balanceOf(to), 300e6, "full token sweep");
        assertEq(v.balances(PID, address(0)), 0);
        assertEq(v.balances(PID, address(usdg)), 0);
        assertEq(v.nonces(PID), 1, "nonce bumped");
        // ⚠ The lifetime figure survives the sweep.
        assertEq(v.totalDeposited(PID, address(0)), 2 ether);
    }

    function test_zeroBalanceAssetIsSkippedNotReverted() public {
        // ⭐ A signature must not go stale because one balance emptied.
        v.deposit{value: 1 ether}(PID);
        address to = address(0xA11CE);
        bytes memory sig = _sign(PID, to, _assets2(), 0, block.timestamp + 900);
        v.claim(PID, to, _assets2(), 0, block.timestamp + 900, sig);
        assertEq(to.balance, 1 ether);
    }

    function test_expiredDeadlineReverts() public {
        v.deposit{value: 1 ether}(PID);
        bytes memory sig = _sign(PID, address(0xA11CE), _assets2(), 0, block.timestamp - 1);
        vm.expectRevert(GitVault.Expired.selector);
        v.claim(PID, address(0xA11CE), _assets2(), 0, block.timestamp - 1, sig);
    }

    function test_wrongNonceReverts() public {
        v.deposit{value: 1 ether}(PID);
        bytes memory sig = _sign(PID, address(0xA11CE), _assets2(), 7, block.timestamp + 900);
        vm.expectRevert(GitVault.BadNonce.selector);
        v.claim(PID, address(0xA11CE), _assets2(), 7, block.timestamp + 900, sig);
    }

    function test_replayIsDeadByNonce() public {
        v.deposit{value: 1 ether}(PID);
        address to = address(0xA11CE);
        bytes memory sig = _sign(PID, to, _assets2(), 0, block.timestamp + 900);
        v.claim(PID, to, _assets2(), 0, block.timestamp + 900, sig);
        v.deposit{value: 1 ether}(PID);
        vm.expectRevert(GitVault.BadNonce.selector);
        v.claim(PID, to, _assets2(), 0, block.timestamp + 900, sig);
    }

    function test_wrongSignerReverts() public {
        v.deposit{value: 1 ether}(PID);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Claim(bytes32 projectId,address to,address[] assets,uint256 nonce,uint256 deadline)"),
            PID, address(0xA11CE), keccak256(abi.encodePacked(_assets2())), uint256(0), block.timestamp + 900
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", v.domainSeparator(), structHash));
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(uint256(0xB0B), digest);
        vm.expectRevert(GitVault.BadSignature.selector);
        v.claim(PID, address(0xA11CE), _assets2(), 0, block.timestamp + 900, abi.encodePacked(r, s, sv));
    }

    function test_tamperedFieldBreaksTheSignature() public {
        v.deposit{value: 1 ether}(PID);
        bytes memory sig = _sign(PID, address(0xA11CE), _assets2(), 0, block.timestamp + 900);
        vm.expectRevert(GitVault.BadSignature.selector);
        v.claim(PID, address(0xBAD), _assets2(), 0, block.timestamp + 900, sig);
    }

    /* ---------------------------------------------------------------- rotation -- */

    function test_rotationWaits48Hours() public {
        address next = address(0xD00D);
        v.announceSigner(next);
        assertEq(v.pendingSigner(), next);
        vm.expectRevert(GitVault.TooEarly.selector);
        v.applySigner();
        vm.warp(block.timestamp + 48 hours);
        v.applySigner();
        assertEq(v.claimSigner(), next);
    }

    function test_oldSignerIsRefusedAfterRotation() public {
        v.deposit{value: 1 ether}(PID);
        v.announceSigner(address(0xD00D));
        vm.warp(block.timestamp + 48 hours);
        v.applySigner();
        bytes memory sig = _sign(PID, address(0xA11CE), _assets2(), 0, block.timestamp + 900);
        vm.expectRevert(GitVault.BadSignature.selector);
        v.claim(PID, address(0xA11CE), _assets2(), 0, block.timestamp + 900, sig);
    }

    function test_onlyOwnerAnnounces() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(GitVault.NotOwner.selector);
        v.announceSigner(address(0xD00D));
    }

    function test_applyWithNothingPendingReverts() public {
        vm.expectRevert(GitVault.NothingPending.selector);
        v.applySigner();
    }
}
