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
            integralFactory: 0x51a744E9FEdb15842c3080d0937C99A365C6c358,
            integralPoolDeployer: 0x02e6f07f6E908245C9f1d83d92b84d0a4815691c,
            integralPosManager: 0x8aD26dc9f724c9A7319E0E25b907d15626D9a056,
            integralPoolInitCodeHash:0xa18736c3ee97fe3c96c9428c0cc2a9116facec18e84f95f9da30543f8238a782
        });

        unsupported = 0x9E18Efb3BE848940b0C92D300504Fb08C287FE85;
    }
}
