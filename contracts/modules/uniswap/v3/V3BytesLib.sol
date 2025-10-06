// SPDX-License-Identifier: GPL-3.0-or-later

/// @title Library for Bytes Manipulation
pragma solidity ^0.8.0;

import {Constants} from '../../../libraries/Constants.sol';

library V3BytesLib {
    error V3PathError();

    /// @notice Returns the pool details starting at byte 0
    /// @dev length and overflow checks must be carried out before calling
    /// @param _bytes The input bytes string to slice
    /// @return token0 The address at byte 0
    /// @return fee The uint24 starting at byte 20
    /// @return token1 The address at byte 23
    function toPool(bytes calldata _bytes) internal pure returns (address token0, uint24 fee, address token1) {
        if (_bytes.length < Constants.V3_POP_OFFSET) revert V3PathError();
        assembly {
            let firstWord := calldataload(_bytes.offset)
            token0 := shr(96, firstWord)
            fee := and(shr(72, firstWord), 0xffffff)
            token1 := shr(96, calldataload(add(_bytes.offset, 23)))
        }
    }
}
