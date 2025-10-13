// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import 'forge-std/console2.sol';
import 'forge-std/Script.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';
import {UnsupportedProtocol} from 'contracts/deploy/UnsupportedProtocol.sol';
import {UniversalRouter} from 'contracts/UniversalRouter.sol';

bytes32 constant SALT = bytes32(uint256(0x00000000000000000000000000000000000000005eb67581652632000a6cbedf));

abstract contract DeployUniversalRouter is Script {
    RouterParameters internal params;
    address internal unsupported;

    address constant UNSUPPORTED_PROTOCOL = address(0);
    bytes32 constant BYTES32_ZERO = bytes32(0);

    error Permit2NotDeployed();

    // set values for params and unsupported
    function setUp() public virtual;

    function run() external returns (UniversalRouter router) {
        vm.startBroadcast();

        // deploy permit2 if it isnt yet deployed
        if (params.permit2 == address(0)) revert Permit2NotDeployed();

        // only deploy unsupported if this chain doesn't already have one
        if (unsupported == address(0)) {
            unsupported = address(new UnsupportedProtocol());
            console2.log('UnsupportedProtocol deployed:', unsupported);
        }

        params = RouterParameters({
            permit2: mapUnsupported(params.permit2),
            weth: mapUnsupported(params.weth),
            uniswapV2Factory: mapUnsupported(params.uniswapV2Factory),
            uniswapV3Factory: mapUnsupported(params.uniswapV3Factory),
            uniswapPairInitCodeHash: params.uniswapPairInitCodeHash,
            uniswapPoolInitCodeHash: params.uniswapPoolInitCodeHash,
            integralFactory: mapUnsupported(params.integralFactory),
            integralPoolDeployer: mapUnsupported(params.integralPoolDeployer),
            integralPosManager: mapUnsupported(params.integralPosManager),
            integralPoolInitCodeHash: params.integralPoolInitCodeHash
        });

        logParams();

        router = new UniversalRouter(params);
        console2.log('Universal Router Deployed:', address(router));
        vm.stopBroadcast();
    }

    function logParams() internal view {
        console2.log('permit2:', params.permit2);
        console2.log('weth:', params.weth);
        console2.log('uniswapV2Factory:', params.uniswapV2Factory);
        console2.log('uniswapV3Factory:', params.uniswapV3Factory);
        console2.log('uniswapPairInitCodeHash:');
        console2.logBytes32(params.uniswapPairInitCodeHash);
        console2.log('uniswapPoolInitCodeHash:');
        console2.logBytes32(params.uniswapPoolInitCodeHash);
        console2.log('integralFactory:', params.integralFactory);
        console2.log('integralPoolDeployer:', params.integralPoolDeployer);
        console2.log('integralPosManager:', params.integralPosManager);
        console2.log('integralPoolInitCodeHash:');
        console2.logBytes32(params.integralPoolInitCodeHash);
    }

    function mapUnsupported(address protocol) internal view returns (address) {
        return protocol == address(0) ? unsupported : protocol;
    }
}
