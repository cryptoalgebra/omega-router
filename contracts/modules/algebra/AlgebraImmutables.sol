// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

struct AlgebraParameters {
    address integralFactory;
    address integralPoolDeployer;
    bytes32 integralPoolInitCodeHash;
}

contract AlgebraImmutables {
    /// @notice The address of UniswapV3Factory
    address internal immutable ALGEBRA_INTEGRAL_FACTORY;

    /// @notice The UniswapV3Pool initcodehash
    bytes32 internal immutable ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH;

    /// @notice The address of Algebra Integral Pool Deployer
    address internal immutable ALGEBRA_INTEGRAL_POOL_DEPLOYER;

    constructor(AlgebraParameters memory params) {
        ALGEBRA_INTEGRAL_POOL_DEPLOYER = params.integralPoolDeployer;
        ALGEBRA_INTEGRAL_FACTORY = params.integralFactory;
        ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH = params.integralPoolInitCodeHash;
    }
}
