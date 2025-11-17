// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice A library used to store a flag indicating if input should be wrapped for exact output swaps; used transiently during swap callback
library ShouldWrapInput {
    // The slot holding the wrap flag, transiently. bytes32(uint256(keccak256("ShouldWrapInput")) - 1)
    bytes32 constant SHOULD_WRAP_INPUT_SLOT = 0x77291d521b04555935cbc31efb81ea91f6f1247e2c7dd6186079d69b871c441f;

    function set(bool shouldWrap) internal {
        assembly ('memory-safe') {
            tstore(SHOULD_WRAP_INPUT_SLOT, shouldWrap)
        }
    }

    function get() internal view returns (bool shouldWrap) {
        assembly ('memory-safe') {
            shouldWrap := tload(SHOULD_WRAP_INPUT_SLOT)
        }
    }
}
