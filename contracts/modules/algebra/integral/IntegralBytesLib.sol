// SPDX-License-Identifier: GPL-3.0-or-later

/// @title Library for Bytes Manipulation
pragma solidity ^0.8.0;

import {Constants} from '../../../libraries/Constants.sol';
import {WrapAction} from '../../../libraries/WrapAction.sol';

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

    /// @notice Returns the boosted pool details starting at byte 0
    /// @dev length and overflow checks must be carried out before calling
    /// @param _bytes The input bytes string to slice
    /// @return token0 The external token address at byte 0
    /// @return wrap0 The wrap action for token0 (NONE, WRAP, or UNWRAP)
    /// @return poolToken0 The pool token address at byte 21
    /// @return deployer The pool deployer address at byte 41
    /// @return poolToken1 The pool token address at byte 61
    /// @return wrap1 The wrap action for token1 (NONE, WRAP, or UNWRAP)
    /// @return token1 The external token address at byte 82
    function toBoostedPool(bytes calldata _bytes)
        internal
        pure
        returns (
            address token0,
            WrapAction wrap0,
            address poolToken0,
            address deployer,
            address poolToken1,
            WrapAction wrap1,
            address token1
        )
    {
        if (_bytes.length < Constants.INTEGRAL_BOOSTED_POOL_POP_OFFSET) {
            revert IntegralPathError();
        }
        uint8 rawWrap0;
        uint8 rawWrap1;
        assembly {
            let firstWord := calldataload(_bytes.offset)
            token0 := shr(96, firstWord)
            rawWrap0 := and(shr(88, firstWord), 0xff)
            poolToken0 := shr(96, calldataload(add(_bytes.offset, 21)))
            deployer := shr(96, calldataload(add(_bytes.offset, 41)))
            poolToken1 := shr(96, calldataload(add(_bytes.offset, 61)))
            rawWrap1 := shr(248, calldataload(add(_bytes.offset, 81)))
            token1 := shr(96, calldataload(add(_bytes.offset, 82)))
        }
        wrap0 = WrapAction(rawWrap0);
        wrap1 = WrapAction(rawWrap1);
    }
}
