// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title Action Flags for Integral Swap Path
/// @notice Defines action flags for wrap/unwrap operations in swap paths
library ActionFlags {
    /// @dev Standard swap - no wrap/unwrap needed
    uint8 internal constant SWAP = 0x00;

    /// @dev Wrap incoming token before swap (underlying → vault token)
    uint8 internal constant WRAP = 0x01;

    /// @dev Unwrap incoming token before swap (vault token → underlying)
    uint8 internal constant UNWRAP = 0x02;

    /// @notice Check if action flag is SWAP
    /// @param flag The action flag byte
    /// @return True if flag is SWAP
    function isSwap(uint8 flag) internal pure returns (bool) {
        return flag == SWAP;
    }

    /// @notice Check if action flag is WRAP
    /// @param flag The action flag byte
    /// @return True if flag is WRAP
    function isWrap(uint8 flag) internal pure returns (bool) {
        return flag == WRAP;
    }

    /// @notice Check if action flag is UNWRAP
    /// @param flag The action flag byte
    /// @return True if flag is UNWRAP
    function isUnwrap(uint8 flag) internal pure returns (bool) {
        return flag == UNWRAP;
    }

    /// @notice Invert action flag for exact output (reverse path)
    /// @dev WRAP becomes UNWRAP, UNWRAP becomes WRAP, SWAP stays SWAP
    /// @param flag The action flag byte
    /// @return Inverted flag
    function invert(uint8 flag) internal pure returns (uint8) {
        if (flag == WRAP) return UNWRAP;
        if (flag == UNWRAP) return WRAP;
        return SWAP;
    }
}
