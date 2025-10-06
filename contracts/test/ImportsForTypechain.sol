// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.17;

import {INonfungiblePositionManager} from '@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol';

// this contract only exists to pull PositionManager and PoolManager into the hardhat build pipeline
// so that typechain artifacts are generated for it
abstract contract ImportsForTypechain is INonfungiblePositionManager {

}
