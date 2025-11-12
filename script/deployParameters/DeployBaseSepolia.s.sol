// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {DeployOmegaRouter} from '../DeployOmegaRouter.s.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';

contract DeployBaseSepolia is DeployOmegaRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
            weth: 0x4200000000000000000000000000000000000006,
            uniswapV2Factory: 0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e,
            uniswapV3Factory: 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24,
            uniswapPairInitCodeHash: 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f,
            uniswapPoolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            integralFactory: address(0), // TODO: Add Algebra Integral factory address for Base Sepolia
            integralPoolDeployer: address(0), // TODO: Add Algebra Integral pool deployer address for Base Sepolia
            integralPosManager: address(0), // TODO: Add Algebra Integral position manager address for Base Sepolia
            integralPoolInitCodeHash: bytes32(0) // TODO: Add Algebra Integral pool init code hash for Base Sepolia
        });

        unsupported = 0x76870DEbef0BE25589A5CddCe9B1D99276C73B4e;
    }
}
