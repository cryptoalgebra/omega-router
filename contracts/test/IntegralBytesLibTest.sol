// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IntegralBytesLib} from '../modules/algebra/integral/IntegralBytesLib.sol';

/// @title Test contract for IntegralBytesLib
contract IntegralBytesLibTest {
    using IntegralBytesLib for bytes;

    /// @notice Exposes toPool function for testing
    function toPool(bytes calldata path) external pure returns (address token0, address deployer, address token1) {
        return path.toPool();
    }
}
