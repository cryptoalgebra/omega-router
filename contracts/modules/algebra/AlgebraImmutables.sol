// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

struct AlgebraParameters {
    address v2Factory;
    address integralFactory;
    bytes32 pairInitCodeHash;
    bytes32 integralPoolInitCodeHash;
}

contract AlgebraImmutables {
    /// @notice The address of UniswapV2Factory
    address internal immutable UNISWAP_V2_FACTORY;

    /// @notice The UniswapV2Pair initcodehash
    bytes32 internal immutable UNISWAP_V2_PAIR_INIT_CODE_HASH;

    /// @notice The address of UniswapV3Factory
    address internal immutable ALGEBRA_INTEGRAL_FACTORY;

    /// @notice The UniswapV3Pool initcodehash
    bytes32 internal immutable ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH;

    constructor(AlgebraParameters memory params) {
        UNISWAP_V2_FACTORY = params.v2Factory;
        UNISWAP_V2_PAIR_INIT_CODE_HASH = params.pairInitCodeHash;
        ALGEBRA_INTEGRAL_FACTORY = params.integralFactory;
        ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH = params.integralPoolInitCodeHash;
    }
}
