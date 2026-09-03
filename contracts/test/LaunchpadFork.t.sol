// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {OpenPonsLaunchpad, IPonsV2Factory} from "../src/OpenPonsLaunchpad.sol";
import {GitVault} from "../src/GitVault.sol";
import {OpenPonsDistributor, IPonsFeeEscrow} from "../src/OpenPonsDistributor.sol";
import {IPoolManager} from "../src/V4Seller.sol";

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * A real launch, on a fork of live Robinhood Chain, through the real Pons V2 factory.
 *
 * ⛔⛔ Nothing short of this proves the launchpad works. `creatorFeeRecipient` being a launch
 * parameter is read off an ABI; that a CONTRACT may call `launchToken`, that the fee recipient is
 * stored as given, and that the economics pin matches are all facts about the deployed factory that
 * only the deployed factory can settle.
 */
contract LaunchpadForkTest is Test {
    address constant FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    GitVault gv;
    address constant CREATOR_PAYOUT = 0x00000000000000000000000000000000caFe0002;
    address constant PLATFORM = 0x00000000000000000000000000000000cafE0009;
    address constant LAUNCHER = 0x00000000000000000000000000000000CaFe0003;
    /// The owner/repo slug itself, as web/src/lib/projects.ts encodes it.
    bytes32 constant PROJECT_ID = bytes32(bytes("vuejs/core"));

    OpenPonsLaunchpad pad;
    IPonsV2Factory f = IPonsV2Factory(FACTORY);

    function setUp() public {
        try vm.createSelectFork(vm.envOr("RHC_RPC", string("http://127.0.0.1:8899"))) {}
        catch { vm.skip(true); return; }
        gv = new GitVault(address(0x5163), address(this));
        pad = new OpenPonsLaunchpad(f, IPoolManager(POOL_MANAGER), USDG, 200, 5_000, address(gv), PLATFORM, 1_000);
    }

    function _params(string memory name, string memory sym, bytes32 salt, address pairToken)
        internal
        view
        returns (IPonsV2Factory.LaunchParams memory p)
    {
        p.name = name;
        p.symbol = sym;
        p.logo = "https://openpons.example/logo.png";
        p.description = "A project launch";
        p.socials = IPonsV2Factory.Socials("", "", "", "https://openpons.example", "");
        p.creatorFeeRecipient = address(0xdead); // ⚠ deliberately wrong; must be overwritten
        p.creatorTaxBps = 0;
        p.buybackEnabled = false;
        p.expectedEconomics = f.previewLaunchEconomics(0, pairToken);
        p.salt = salt;
    }

    /// ⭐⭐ The one that matters: a real token, whose fees are pointed at a real distributor.
    function test_aRealLaunchPointsItsFeesAtTheDistributor() public {
        vm.deal(LAUNCHER, 1 ether);
        uint256 fee = f.launchFee();

        /* ⚠⚠ BUILT BEFORE THE PRANK, NOT INSIDE THE CALL. Arguments evaluate first, and `_params`
           makes an external call to `previewLaunchEconomics` — so written inline it is that read,
           not the launch, that `vm.prank` and `vm.expectRevert` attach to. It cost a false
           "did not revert" on the split test and would have made every `creator` assertion here
           silently test the test contract instead of the launcher. */
        IPonsV2Factory.LaunchParams memory p =
            _params("Project Test", "CTEST", keccak256("project-test-1"), address(0));

        vm.prank(LAUNCHER);
        (address token, address curve, address dist) =
            pad.launch{value: fee}(p, 0, address(0), PROJECT_ID, CREATOR_PAYOUT, 9_000);

        console.log("token      ", token);
        console.log("curve      ", curve);
        console.log("distributor", dist);

        assertTrue(token != address(0), "no token");
        IPonsV2Factory.LaunchedToken memory lt = f.getLaunchedToken(token);
        assertTrue(lt.exists, "the factory does not know this token");
        assertEq(lt.creatorFeeRecipient, dist, "THE fact: fees are pointed at the distributor");
        assertEq(lt.deployer, address(pad), "the launchpad is the deployer");
        assertEq(pad.entryOf(token).creator, LAUNCHER, "the launcher is credited, not the launchpad");
        /* ⭐ The promise itself: WHICH project, on chain, unchangeable. The vault the money passes
           through is operated, but who it is destined for is not. */
        assertEq(pad.entryOf(token).projectId, PROJECT_ID, "the project id is recorded immutably");

        // The distributor really is ours, with the terms baked in.
        OpenPonsDistributor cd = OpenPonsDistributor(payable(dist));
        assertEq(cd.gitVault(), address(gv));
        assertEq(cd.projectId(), PROJECT_ID);
        assertEq(cd.opsVault(), CREATOR_PAYOUT);
        assertEq(cd.projectBps(), 9_000);
        assertEq(address(cd.escrow()), f.feeEscrow(), "wired to the real escrow");
    }

    /* ══ the developer buy ═══════════════════════════════════════════════════════════════════

       ⛔⛔ THE ONE THAT COULD LOSE A LAUNCHER'S MONEY FOR GOOD.

       Pons V1 chose the buyer for you: `initialBuyRecipient = feeWallet == 0 ? msg.sender :
       feeWallet`, so a developer buy on a launch whose fee recipient was another wallet paid for
       tokens that landed in THAT wallet. It has fired on this stack before and cost 2.84% of a
       supply. Here the fee recipient is a `OpenPonsDistributor`, which has no owner and no function
       that can move a token balance out, so the V1 behaviour would put a launcher's purchase
       somewhere nobody could ever retrieve it.

       ➤ These assert the tokens are with the LAUNCHER and that neither the distributor nor the
       launchpad is holding any. Reading only the launcher's balance would pass just as happily if
       the periphery had also dusted the other two.
    */
    function test_aDevBuyLandsWithTheLauncherAndNowhereElse() public {
        vm.deal(LAUNCHER, 5 ether);
        uint256 fee = f.launchFee();
        uint256 buy = 0.05 ether;

        IPonsV2Factory.LaunchParams memory p =
            _params("Dev Buy", "DBUY", keccak256("project-devbuy-1"), address(0));

        address[] memory none = new address[](0);
        vm.prank(LAUNCHER);
        (address token,, address dist) = pad.launchWithBuy{value: fee + buy}(
            p, 0, address(0),
            OpenPonsLaunchpad.ProjectTerms(PROJECT_ID, CREATOR_PAYOUT, 9_000),
            OpenPonsLaunchpad.DevBuy(buy, 0),
            none
        );

        uint256 got = IERC20Bal(token).balanceOf(LAUNCHER);
        console.log("launcher tokens", got);
        assertGt(got, 0, "the developer buy must reach the launcher");
        assertEq(IERC20Bal(token).balanceOf(dist), 0, "the DISTRIBUTOR must never hold the buy");
        assertEq(IERC20Bal(token).balanceOf(address(pad)), 0, "nor may the launchpad keep it");
        assertEq(f.getLaunchedToken(token).creatorFeeRecipient, dist, "fees still point at the distributor");
        assertEq(pad.entryOf(token).creator, LAUNCHER, "and the launcher is still credited");
    }

    /// ⚠ The value check on the periphery is EXACT. Too much or too little must not half-launch.
    function test_aWrongValueRevertsRatherThanHalfLaunching() public {
        vm.deal(LAUNCHER, 5 ether);
        uint256 fee = f.launchFee();
        IPonsV2Factory.LaunchParams memory p =
            _params("Bad Value", "BADV", keccak256("project-devbuy-2"), address(0));
        address[] memory none = new address[](0);

        vm.prank(LAUNCHER);
        vm.expectRevert();
        pad.launchWithBuy{value: fee}( // ⛔ the buy amount is not covered by the value sent
            p, 0, address(0),
            OpenPonsLaunchpad.ProjectTerms(PROJECT_ID, CREATOR_PAYOUT, 9_000),
            OpenPonsLaunchpad.DevBuy(0.05 ether, 0),
            none
        );
    }

    /// ⭐ Zero buy through the same entrypoint is the plain launch, and still lands correctly.
    function test_launchWithBuyAtZeroIsJustALaunch() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p =
            _params("No Buy", "NOBUY", keccak256("project-devbuy-3"), address(0));
        address[] memory none = new address[](0);
        /* ⚠⚠ HOISTED. `f.launchFee()` written inline in the value block is an external call, and
           arguments evaluate after `vm.prank` is armed, so the prank lands on THAT read and the
           launch runs as the test contract. It is the same trap the note above records, in a place
           it was not being looked for: the value block rather than the argument list. */
        uint256 fee = f.launchFee();

        vm.prank(LAUNCHER);
        (address token,, address dist) = pad.launchWithBuy{value: fee}(
            p, 0, address(0),
            OpenPonsLaunchpad.ProjectTerms(PROJECT_ID, CREATOR_PAYOUT, 10_000),
            OpenPonsLaunchpad.DevBuy(0, 0),
            none
        );
        assertEq(f.getLaunchedToken(token).creatorFeeRecipient, dist);
        assertEq(IERC20Bal(token).balanceOf(LAUNCHER), 0, "no buy was asked for, so none happened");
    }

    /* ⭐⭐ Snipe tax exemptions on a launch with NO developer buy. This is the four argument
       overload, a second entrypoint rather than a variant, and the only way to declare a wallet on a
       launch that does not buy. An empty array takes the three argument call instead. */
    function test_exemptionsOnALaunchWithNoBuy() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p =
            _params("Exempt", "EXMPT", keccak256("project-exempt-1"), address(0));

        address[] memory team = new address[](2);
        team[0] = 0x00000000000000000000000000000000CaFe0011;
        team[1] = 0x00000000000000000000000000000000CAFe0012;
        uint256 fee = f.launchFee(); // ⚠ hoisted, see the note in the zero buy test

        vm.prank(LAUNCHER);
        (address token,, address dist) = pad.launchWithBuy{value: fee}(
            p, 0, address(0),
            OpenPonsLaunchpad.ProjectTerms(PROJECT_ID, CREATOR_PAYOUT, 10_000),
            OpenPonsLaunchpad.DevBuy(0, 0),
            team
        );
        assertTrue(token != address(0), "the four argument overload must launch");
        assertEq(f.getLaunchedToken(token).creatorFeeRecipient, dist);
        assertEq(pad.entryOf(token).creator, LAUNCHER);
    }

    /// A developer buy AND declared exemptions together, the fullest path.
    function test_aDevBuyWithExemptions() public {
        vm.deal(LAUNCHER, 5 ether);
        uint256 fee = f.launchFee();
        uint256 buy = 0.02 ether;
        IPonsV2Factory.LaunchParams memory p =
            _params("Both", "BOTH", keccak256("project-both-1"), address(0));

        address[] memory team = new address[](1);
        team[0] = 0x00000000000000000000000000000000Cafe0013;

        vm.prank(LAUNCHER);
        (address token,,) = pad.launchWithBuy{value: fee + buy}(
            p, 0, address(0),
            OpenPonsLaunchpad.ProjectTerms(PROJECT_ID, CREATOR_PAYOUT, 8_000),
            OpenPonsLaunchpad.DevBuy(buy, 0),
            team
        );
        assertGt(IERC20Bal(token).balanceOf(LAUNCHER), 0, "the buy still reaches the launcher");
    }

    /// ⛔ A caller cannot smuggle their own fee recipient through the params.
    function test_aSuppliedFeeRecipientIsIgnored() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p = _params("Sneaky", "SNEAK", keccak256("project-test-2"), address(0));
        vm.prank(LAUNCHER);
        (address token,, address dist) =
            pad.launch{value: f.launchFee()}(p, 0, address(0), PROJECT_ID, CREATOR_PAYOUT, 10_000);
        assertEq(f.getLaunchedToken(token).creatorFeeRecipient, dist);
        assertTrue(f.getLaunchedToken(token).creatorFeeRecipient != address(0xdead));
    }

    /// A USDG-paired launch — the pairing this launchpad recommends, since USDG remits cheapest.
    function test_aUsdgPairedLaunch() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p = _params("Usdg Project", "UCHAR", keccak256("project-test-3"), USDG);
        vm.prank(LAUNCHER);
        (address token,, address dist) =
            pad.launch{value: f.launchFee()}(p, 0, USDG, PROJECT_ID, CREATOR_PAYOUT, 7_500);
        IPonsV2Factory.LaunchedToken memory lt = f.getLaunchedToken(token);
        assertEq(lt.pairToken, USDG, "paired against USDG");
        assertEq(lt.creatorFeeRecipient, dist);
    }

    /// ⛔⛔ The floor is on chain, not in the front end.
    function test_aStingySplitIsRefused() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p = _params("Stingy", "STGY", keccak256("project-test-4"), address(0));
        uint256 fee = f.launchFee();
        vm.prank(LAUNCHER);
        vm.expectRevert(abi.encodeWithSelector(OpenPonsLaunchpad.ProjectShareTooSmall.selector, uint16(100), uint16(5_000)));
        pad.launch{value: fee}(p, 0, address(0), PROJECT_ID, CREATOR_PAYOUT, 100);
    }

    /// The registry a static site reads with one `eth_call`, instead of an indexer it cannot run.
    function test_theRegistryIsReadableNewestFirst() public {
        vm.deal(LAUNCHER, 1 ether);
        IPonsV2Factory.LaunchParams memory p1 = _params("One", "ONE", keccak256("r1"), address(0));
        IPonsV2Factory.LaunchParams memory p2 = _params("Two", "TWO", keccak256("r2"), address(0));
        uint256 fee = f.launchFee();
        vm.startPrank(LAUNCHER);
        pad.launch{value: fee}(p1, 0, address(0), PROJECT_ID, CREATOR_PAYOUT, 9_000);
        pad.launch{value: fee}(p2, 0, address(0), PROJECT_ID, CREATOR_PAYOUT, 8_000);
        vm.stopPrank();

        assertEq(pad.count(), 2);
        OpenPonsLaunchpad.Entry[] memory p = pad.page(0, 10);
        assertEq(p.length, 2);
        assertEq(p[0].projectBps, 8_000, "newest first");
        assertEq(p[1].projectBps, 9_000);
        assertTrue(pad.isProjectLaunch(p[0].token));
        assertFalse(pad.isProjectLaunch(address(0xbeef)));

        // ⚠ A page past the end clamps rather than reverting.
        assertEq(pad.page(5, 10).length, 0);
        assertEq(pad.page(1, 10).length, 1);
    }
}
