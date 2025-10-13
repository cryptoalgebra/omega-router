// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

struct AlgebraParameters {
    address integralFactory;
    address integralPoolDeployer;
    address integralPositionManager;
    bytes32 integralPoolInitCodeHash;
}

contract AlgebraImmutables {
    /// @notice The address of UniswapV3Factory
    address internal immutable ALGEBRA_INTEGRAL_FACTORY;

    /// @notice The address of Algebra Integral Pool Deployer
    address internal immutable ALGEBRA_INTEGRAL_POOL_DEPLOYER;

    /// @notice The address of Algebra Integral Nonfungible Position Manager
    address internal immutable ALGEBRA_INTEGRAL_POSITION_MANAGER;

    /// @notice The UniswapV3Pool initcodehash
    bytes32 internal immutable ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH;

    constructor(AlgebraParameters memory params) {
        ALGEBRA_INTEGRAL_FACTORY = params.integralFactory;
        ALGEBRA_INTEGRAL_POOL_DEPLOYER = params.integralPoolDeployer;
        ALGEBRA_INTEGRAL_POSITION_MANAGER = params.integralPositionManager;
        ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH = params.integralPoolInitCodeHash;
    }
}
