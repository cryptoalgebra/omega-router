// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.6.0;

import {IntegralBytesLib} from './IntegralBytesLib.sol';
import {Constants} from '../../../libraries/Constants.sol';
import {CalldataDecoder} from '../../../libraries/CalldataDecoder.sol';

/// @title Functions for manipulating path data for multihop swaps
library IntegralPath {
    using CalldataDecoder for bytes;
    using IntegralBytesLib for bytes;

    /// @notice Returns true iff the path contains two or more pools
    /// @param path The encoded swap path
    /// @return True if path contains two or more pools, otherwise false
    function hasMultiplePools(bytes calldata path) internal pure returns (bool) {
        return path.length >= Constants.INTEGRAL_MULTIPLE_POOLS_MIN_LENGTH;
    }

    /// @notice Decodes the first pool in path with action flag and vault address
    /// @param path The bytes encoded swap path
    /// @return tokenA The first token of the given pool
    /// @return flag The action flag (SWAP/WRAP/UNWRAP)
    /// @return vaultAddress The vault address (ERC4626 vault for WRAP/UNWRAP, 0x0 for SWAP)
    /// @return deployer The deployer address of the given pool
    /// @return tokenB The second token of the given pool
    function decodeFirstPoolWithVault(bytes calldata path)
        internal
        pure
        returns (address tokenA, uint8 flag, address vaultAddress, address deployer, address tokenB)
    {
        return path.toPoolWithVault();
    }

    /// @notice Decodes the first pool in path (legacy - for backward compatibility)
    /// @param path The bytes encoded swap path
    /// @return tokenA The first token of the given pool
    /// @return deployer The deployer address of the given pool
    /// @return tokenB The second token of the given pool
    function decodeFirstPool(bytes calldata path) internal pure returns (address, address, address) {
        return path.toPool();
    }

    /// @notice Gets the segment corresponding to the first pool in the path
    /// @param path The bytes encoded swap path
    /// @return The segment containing all data necessary to target the first pool in the path
    function getFirstPool(bytes calldata path) internal pure returns (bytes calldata) {
        return path[:Constants.INTEGRAL_POP_OFFSET];
    }

    function decodeFirstToken(bytes calldata path) internal pure returns (address tokenA) {
        tokenA = path.toAddress();
    }

    /// @notice Skips a token + flag + vault + deployer element (new format)
    /// @param path The swap path
    function skipToken(bytes calldata path) internal pure returns (bytes calldata) {
        return path[Constants.INTEGRAL_NEXT_OFFSET:];
    }
}
