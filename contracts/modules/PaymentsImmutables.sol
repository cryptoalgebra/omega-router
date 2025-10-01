// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IWETH} from '../interfaces/IWETH.sol';
import {IPermit2} from 'permit2/src/interfaces/IPermit2.sol';

struct PaymentsParameters {
    address permit2;
    address weth;
}

contract PaymentsImmutables {
    /// @notice WETH address
    IWETH internal immutable WETH;

    /// @notice Permit2 address
    IPermit2 internal immutable PERMIT2;

    constructor(PaymentsParameters memory params) {
        WETH = IWETH(params.weth);
        PERMIT2 = IPermit2(params.permit2);
    }
}
