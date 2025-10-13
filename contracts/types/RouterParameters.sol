// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

struct RouterParameters {
    // Payment parameters
    address permit2;
    address weth;
    // Uniswap swapping parameters
    address uniswapV2Factory;
    address uniswapV3Factory;
    bytes32 uniswapPairInitCodeHash;
    bytes32 uniswapPoolInitCodeHash;
    // Algebra Integral parameters
    address integralFactory;
    address integralPoolDeployer;
    address integralPosManager;
    bytes32 integralPoolInitCodeHash;
}
