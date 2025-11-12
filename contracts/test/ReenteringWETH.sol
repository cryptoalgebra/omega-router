// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.15;

import {ERC20} from 'solmate/src/tokens/ERC20.sol';

contract ReenteringWETH is ERC20 {
    error NotAllowedReenter();

    address omegaRouter;
    bytes data;

    constructor() ERC20('ReenteringWETH', 'RW', 18) {}

    function setParameters(address _omegaRouter, bytes memory _data) external {
        omegaRouter = _omegaRouter;
        data = _data;
    }

    function deposit() public payable {
        (bool success,) = omegaRouter.call(data);
        if (!success) revert NotAllowedReenter();
    }
}
