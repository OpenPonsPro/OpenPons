// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {GitVault} from "../src/GitVault.sol";

/**
 * The cross-stack pin. `verifier/scripts/make-vector.mjs` signed ONE claim with viem and committed
 * the bytes; this suite proves the contract accepts exactly those bytes. If either side changes its
 * EIP-712 encoding — the struct, the domain, the array hashing — one of the two stacks goes red
 * against the committed fixture instead of both drifting together.
 */
contract ClaimVectorTest is Test {
    using stdJson for string;

    string json;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/../verifier/test/fixtures/claim-vector.json"));
    }

    function _vault() internal returns (GitVault v, bytes32 pid, address to, address[] memory assets, bytes memory sig) {
        vm.chainId(uint256(json.readUint(".domain.chainId")));
        address at = json.readAddress(".domain.verifyingContract");
        deployCodeTo("GitVault.sol:GitVault", abi.encode(json.readAddress(".signer"), address(1)), at);
        v = GitVault(at);
        pid = json.readBytes32(".claim.projectId");
        to = json.readAddress(".claim.to");
        assets = json.readAddressArray(".claim.assets");
        sig = json.readBytes(".signature");
    }

    function test_theCommittedSignatureClaims() public {
        (GitVault v, bytes32 pid, address to, address[] memory assets, bytes memory sig) = _vault();
        vm.deal(address(this), 1 ether);
        v.deposit{value: 1 ether}(pid);
        // ⚠ The fixture lists a second, empty asset on purpose: the skip path rides the vector too.
        v.claim(pid, to, assets, 0, json.readUint(".claim.deadline"), sig);
        assertEq(to.balance, 1 ether, "the vector's claim paid out");
    }

    function test_aFlippedByteIsRefused() public {
        (GitVault v, bytes32 pid, address to, address[] memory assets, bytes memory sig) = _vault();
        vm.deal(address(this), 1 ether);
        v.deposit{value: 1 ether}(pid);
        sig[10] = bytes1(uint8(sig[10]) ^ 0xff);
        /* ⚠ Which refusal depends on WHERE the flip lands: a mangled point reverts inside ECDSA
           itself, a valid-but-wrong signature reverts BadSignature here. Both are the property. */
        vm.expectRevert();
        v.claim(pid, to, assets, 0, json.readUint(".claim.deadline"), sig);
    }
}
