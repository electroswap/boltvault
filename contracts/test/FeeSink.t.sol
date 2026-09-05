// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BoltVaultFeeSink} from "../src/BoltVaultFeeSink.sol";

contract MockErc20 {
    mapping(address => uint256) public balanceOf;
    bool public returnsNothing;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setReturnsNothing(bool v) external {
        returnsNothing = v;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (returnsNothing) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}

contract FeeSinkTest is Test {
    BoltVaultFeeSink sink;
    MockErc20 token;
    address owner = address(0xA11CE);
    address treasury = address(0x7EA5);

    function setUp() public {
        sink = new BoltVaultFeeSink(owner);
        token = new MockErc20();
    }

    function test_receivesEtnAndSweeps() public {
        vm.deal(address(this), 1 ether);
        (bool ok, ) = address(sink).call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(owner);
        sink.sweepETN(payable(treasury), 0.4 ether);
        assertEq(treasury.balance, 0.4 ether);
        assertEq(address(sink).balance, 0.6 ether);
    }

    function test_sweepsTokensIncludingNonStandardReturns() public {
        token.mint(address(sink), 100);
        vm.prank(owner);
        sink.sweep(address(token), treasury, 40);
        assertEq(token.balanceOf(treasury), 40);
        token.setReturnsNothing(true);
        vm.prank(owner);
        sink.sweep(address(token), treasury, 60);
        assertEq(token.balanceOf(treasury), 100);
    }

    function test_onlyOwnerSweeps() public {
        vm.expectRevert(BoltVaultFeeSink.NotOwner.selector);
        sink.sweep(address(token), treasury, 1);
        vm.expectRevert(BoltVaultFeeSink.NotOwner.selector);
        sink.sweepETN(payable(treasury), 1);
    }

    function test_failedTransferReverts() public {
        vm.prank(owner);
        vm.expectRevert(BoltVaultFeeSink.TransferFailed.selector);
        sink.sweep(address(token), treasury, 1); // no balance
    }

    function test_twoStepOwnership() public {
        vm.prank(owner);
        sink.transferOwnership(treasury);
        vm.expectRevert(BoltVaultFeeSink.NotPendingOwner.selector);
        sink.acceptOwnership();
        vm.prank(treasury);
        sink.acceptOwnership();
        assertEq(sink.owner(), treasury);
    }
}
