// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.6.0;

import {IntegralBytesLib} from './IntegralBytesLib.sol';
import {Constants} from '../../../libraries/Constants.sol';
import {CalldataDecoder} from '../../../libraries/CalldataDecoder.sol';
import {WrapAction} from '../../../libraries/WrapAction.sol';

/// @title Functions for manipulating path data for multihop swaps
library IntegralBoostedPath {
    using CalldataDecoder for bytes;
    using IntegralBytesLib for bytes;

    /// @notice Returns true iff the path contains two or more pools
    /// @param path The encoded swap path
    /// @return True if path contains two or more pools, otherwise false
    function hasMultipleBoostedPools(bytes calldata path) internal pure returns (bool) {
        return path.length >= Constants.INTEGRAL_MULTIPLE_BOOSTED_POOLS_MIN_LENGTH;
    }

    /// @notice Decodes the first pool in path
    /// @param path The bytes encoded swap path
    /// @return tokenA The first token of the given pool
    /// @return deployer The deployer address of the given pool
    /// @return tokenB The second token of the given pool
    function decodeFirstBoostedPool(bytes calldata path)
        internal
        pure
        returns (address, WrapAction, address, address, address, WrapAction, address)
    {
        return path.toBoostedPool();
    }

    /// @notice Gets the segment corresponding to the first pool in the path
    /// @param path The bytes encoded swap path
    /// @return The segment containing all data necessary to target the first pool in the path
    function getFirstBoostedPool(bytes calldata path) internal pure returns (bytes calldata) {
        return path[:Constants.INTEGRAL_BOOSTED_POOL_OFFSET];
    }

    /// @notice Returns the number of pools in the path
    /// @param path The encoded swap path
    /// @return The number of pools in the path
    function boostedNumPools(bytes calldata path) internal pure returns (uint256) {
        // Ignore the first token address. From then on every fee and token offset indicates a pool.
        return ((path.length - Constants.ADDR_SIZE) / Constants.INTEGRAL_BOOSTED_POOL_NEXT_OFFSET);
    }

    function decodeFirstTokenInBoostedPath(bytes calldata path) internal pure returns (address tokenA) {
        tokenA = path.toAddress();
    }

    /// @notice Skips a token + pool deployer element
    /// @param path The swap path
    function skipTokenInBoostedPath(bytes calldata path) internal pure returns (bytes calldata) {
        return path[Constants.INTEGRAL_BOOSTED_POOL_NEXT_OFFSET:];
    }
}
