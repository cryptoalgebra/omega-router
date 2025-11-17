// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice A library used to store a flag indicating if input should be wrapped for exact output swaps; used transiently during swap callback
library ShouldWrapInput {
    // The slot holding the wrap flag, transiently. bytes32(uint256(keccak256("ShouldWrapInput")) - 1)
    bytes32 constant SHOULD_WRAP_INPUT_SLOT = 0x5c4978da00d5c4b5f5c8b1b85c44d0c4e964c5e9a6db4f5f8e5c8f5e8f5e8f5e;

    function set(bool shouldWrap) internal {
        assembly ("memory-safe") {
            tstore(SHOULD_WRAP_INPUT_SLOT, shouldWrap)
        }
    }

    function get() internal view returns (bool shouldWrap) {
        assembly ("memory-safe") {
            shouldWrap := tload(SHOULD_WRAP_INPUT_SLOT)
        }
    }
}
