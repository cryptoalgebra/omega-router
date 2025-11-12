// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {DeployOmegaRouter} from '../DeployOmegaRouter.s.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';

contract DeployBase is DeployOmegaRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
            weth: 0x4200000000000000000000000000000000000006,
            uniswapV2Factory: 0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6,
            uniswapV3Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD,
            uniswapPairInitCodeHash: 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f,
            uniswapPoolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            integralFactory: address(0), // TODO: Add Algebra Integral factory address for Base
            integralPoolDeployer: address(0), // TODO: Add Algebra Integral pool deployer address for Base
            integralPosManager: address(0), // TODO: Add Algebra Integral position manager address for Base
            integralPoolInitCodeHash: bytes32(0) // TODO: Add Algebra Integral pool init code hash for Base
        });

        unsupported = 0x9E18Efb3BE848940b0C92D300504Fb08C287FE85;
    }
}
