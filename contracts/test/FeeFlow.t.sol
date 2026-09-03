// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {OpenPonsLaunchpad, IPonsV2Factory} from "../src/OpenPonsLaunchpad.sol";
import {GitVault} from "../src/GitVault.sol";
import {OpenPonsDistributor, IPonsFeeEscrow} from "../src/OpenPonsDistributor.sol";
import {IPoolManager} from "../src/V4Seller.sol";

interface ICurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256);
    /* ⛔ `sweepFees(uint256)`, NOT `sweepFees()`. The argument is the slippage floor for the buyback
       leg. A no-arg version compiles fine, is a different selector, and reverts with no data, which
       is indistinguishable from a permission failure. */
    function sweepFees(uint256 minBuybackTokensOut) external;
    function getReserves() external view returns (uint256, uint256);
}
interface IERC20 { function balanceOf(address) external view returns (uint256); function approve(address,uint256) external returns (bool); }

/**
 * The whole money path, executed on a fork of live Robinhood Chain: launch, trade, sweep, harvest,
 * and the project's share landing in the vault.
 *
 * ⛔⛔ WHY THIS IS SEPARATE FROM THE UNIT TESTS. Those prove the distributor splits what it is given,
 * against a mock escrow written by the same hand. This proves that a REAL trade on a REAL Pons curve
 * produces fees that a REAL escrow hands over. Every step between "somebody buys the token" and
 * "the project's share exists" is somebody else's contract, and the only way to know they connect is
 * to make them connect.
 */
contract FeeFlowTest is Test {
    address constant FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    GitVault gv;
    // ⚠ Anvil's first well-known key. Tests only; it signs the maintainer claim at the end.
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant CREATOR = 0x00000000000000000000000000000000caFe0002;
    address constant PLATFORM = 0x00000000000000000000000000000000cafE0009;
    address constant LAUNCHER = 0x00000000000000000000000000000000CaFe0003;
    address constant TRADER = 0x00000000000000000000000000000000caFe0004;
    bytes32 constant PROJECT_ID = bytes32(bytes("vuejs/core"));

    OpenPonsLaunchpad pad;
    IPonsV2Factory f = IPonsV2Factory(FACTORY);

    function setUp() public {
        try vm.createSelectFork(vm.envOr("RHC_RPC", string("http://127.0.0.1:8899"))) {}
        catch { vm.skip(true); return; }
        gv = new GitVault(vm.addr(SIGNER_PK), address(this));
        pad = new OpenPonsLaunchpad(f, IPoolManager(POOL_MANAGER), USDG, 200, 5_000, address(gv), PLATFORM, 1_000);
    }

    function test_aRealTradeProducesFeesThatReachTheVault() public {
        // ── launch ────────────────────────────────────────────────────────────────────────────
        IPonsV2Factory.LaunchParams memory p;
        p.name = "Fee Flow";
        p.symbol = "FLOW";
        p.socials = IPonsV2Factory.Socials("", "", "", "", "");
        p.expectedEconomics = f.previewLaunchEconomics(0, address(0));
        p.salt = keccak256("fee-flow-1");

        vm.deal(LAUNCHER, 1 ether);
        vm.prank(LAUNCHER);
        (address token, address curve, address dist) =
            pad.launch{value: f.launchFee()}(p, 0, address(0), PROJECT_ID, CREATOR, 9_000);

        // ── somebody buys ─────────────────────────────────────────────────────────────────────
        vm.deal(TRADER, 20 ether);
        vm.prank(TRADER);
        ICurve(curve).buy{value: 10 ether}(10 ether, 0, TRADER);
        uint256 bought = IERC20(token).balanceOf(TRADER);
        assertGt(bought, 0, "the buy produced no tokens");

        // ── and sells, because a fee is charged on both legs ───────────────────────────────────
        vm.startPrank(TRADER);
        IERC20(token).approve(curve, bought);
        ICurve(curve).sell(bought / 2, 0, TRADER);
        vm.stopPrank();

        /*
          ⚠⚠ THE SWEEP IS A SEPARATE STEP AND IT IS NOT OURS. Fees accrue on the curve and reach the
          escrow only when somebody sweeps. A test that harvested without sweeping would read zero
          and look like a broken distributor, when the money simply had not moved yet.
        */
        /*
          ⛔⛔ `sweepFees` IS PERMISSIONED, and it reverts `NotFeeSweepOperator()` for everyone but
          Pons's own operator and THIS LAUNCH'S FEE RECIPIENT. The fee recipient is the distributor,
          so the distributor is the only party on our side that may sweep.
        */
        /* ⭐⭐ Swept THROUGH the distributor by a stranger, which is the whole reason the passthrough
           exists: no key of ours is involved anywhere in the chain from trade to payout. */
        vm.prank(address(0xbeef));
        OpenPonsDistributor(payable(dist)).sweepCurve(curve, 0);

        uint256 owed = OpenPonsDistributor(payable(dist)).pending(address(0));
        console.log("swept into the escrow for this launch (wei):", owed);
        assertGt(owed, 0, "trading produced no claimable fees");

        // ── harvest: permissionless, so anybody can trigger the payout ─────────────────────────
        uint256 vaultBefore = gv.balances(PROJECT_ID, address(0));
        uint256 creatorBefore = CREATOR.balance;
        uint256 platformBefore = PLATFORM.balance;
        vm.prank(address(0xdead)); // ⭐ a stranger, to prove it needs no privileged key
        OpenPonsDistributor(payable(dist)).harvest();

        uint256 toProject = gv.balances(PROJECT_ID, address(0)) - vaultBefore;
        uint256 toCreator = CREATOR.balance - creatorBefore;
        uint256 toPlatform = PLATFORM.balance - platformBefore;
        console.log("to the project vault (wei):", toProject);
        console.log("to the creator (wei):     ", toCreator);
        console.log("to the platform (wei):    ", toPlatform);

        assertGt(toProject, 0, "the project share never arrived");
        assertEq(toPlatform + toProject + toCreator, owed, "every wei was split and pushed");
        // ⭐ The three-leg arithmetic, verified on REAL money: 10% off the top for the platform,
        //    then 90/10 of the rest, with division dust falling on the project side.
        assertEq(toPlatform, (owed * 1_000) / 10_000, "the platform got exactly its tenth, first");
        uint256 rest = owed - toPlatform;
        assertEq(toCreator, (rest * 1_000) / 10_000, "the creator got its tenth of the rest");
        assertEq(OpenPonsDistributor(payable(dist)).totalToProject(address(0)), toProject, "the ledger agrees");
        assertEq(address(dist).balance, 0, "nothing rested in the distributor");

        /* ── the maintainer claims: launch → trade → harvest → claim, one unbroken path ─────────
           ⭐⭐ THE WHOLE PROMISE ON REAL STATE: everything the repo earned from a real trade on the
           real Pons factory leaves for the maintainer's wallet on one signature. */
        address maintainer = address(0xFEE71);
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Claim(bytes32 projectId,address to,address[] assets,uint256 nonce,uint256 deadline)"),
            PROJECT_ID, maintainer, keccak256(abi.encodePacked(assets)), uint256(0), block.timestamp + 900
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gv.domainSeparator(), structHash));
        (uint8 sv, bytes32 r, bytes32 sVal) = vm.sign(SIGNER_PK, digest);
        gv.claim(PROJECT_ID, maintainer, assets, 0, block.timestamp + 900, abi.encodePacked(r, sVal, sv));
        assertEq(maintainer.balance, toProject, "the maintainer received everything the repo earned");
        assertEq(gv.balances(PROJECT_ID, address(0)), 0, "the treasury swept clean");
    }
}
