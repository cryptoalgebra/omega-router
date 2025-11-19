// SPDX-License-Identifier: GPL-3.0-or-later

/// @title Library for Bytes Manipulation
pragma solidity ^0.8.0;

import {Constants} from '../../../libraries/Constants.sol';

library IntegralBytesLib {
    error IntegralPathError();

    /// @notice Returns the pool details starting at byte 0
    /// @dev length and overflow checks must be carried out before calling
    /// @param _bytes The input bytes string to slice
    /// @return token0 The address at byte 0
    /// @return deployer The address of a pool deployer at byte 20
    /// @return token1 The address at byte 40
    function toPool(bytes calldata _bytes) internal pure returns (address token0, address deployer, address token1) {
        if (_bytes.length < Constants.INTEGRAL_POP_OFFSET) revert IntegralPathError();
        assembly {
            let firstWord := calldataload(_bytes.offset)
            token0 := shr(96, firstWord)
            deployer := shr(96, calldataload(add(_bytes.offset, 20)))
            token1 := shr(96, calldataload(add(_bytes.offset, 40)))
        }
    }
}
