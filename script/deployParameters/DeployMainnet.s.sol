// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {DeployOmegaRouter} from '../DeployOmegaRouter.s.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';

contract DeployMainnet is DeployOmegaRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
            weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            uniswapV2Factory: 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f,
            uniswapV3Factory: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
            uniswapPairInitCodeHash: 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f,
            uniswapPoolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            integralFactory: address(0), // TODO: Add Algebra Integral factory address for mainnet
            integralPoolDeployer: address(0), // TODO: Add Algebra Integral pool deployer address for mainnet
            integralPosManager: address(0), // TODO: Add Algebra Integral position manager address for mainnet
            integralPoolInitCodeHash: bytes32(0) // TODO: Add Algebra Integral pool init code hash for mainnet
        });

        unsupported = 0x76D631990d505E4e5b432EEDB852A60897824D68;
    }
}
