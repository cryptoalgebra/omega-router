import { UniversalRouter, ERC20, IWETH, IPermit2 } from '../../typechain'
import { expect } from './shared/expect'
import { abi as ROUTER_ABI } from '../../artifacts/contracts/UniversalRouter.sol/UniversalRouter.json'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as WETH_ABI } from '../../artifacts/contracts/interfaces/IWETH.sol/IWETH.json'

import deployUniversalRouter from './shared/deployUniversalRouter'
import {
  ADDRESS_THIS,
  MAINNET_ALICE_ADDRESS,
  DEADLINE,
  SOURCE_MSG_SENDER,
  MAX_UINT160,
  MAX_UINT,
  ETH_ADDRESS,
} from './shared/constants'
import { resetFork, MAINNET_WETH, MAINNET_DAI, PERMIT2 } from './shared/mainnetForkHelpers'
import { CommandType, RoutePlanner } from './shared/planner'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expandTo18DecimalsBN } from './shared/helpers'
import hre from 'hardhat'

const { ethers } = hre
const routerInterface = new ethers.utils.Interface(ROUTER_ABI)

describe('UniversalRouter', () => {
  let alice: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let daiContract: ERC20
  let wethContract: IWETH

  beforeEach(async () => {
    await resetFork()
    alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MAINNET_ALICE_ADDRESS],
    })

    daiContract = new ethers.Contract(MAINNET_DAI.address, TOKEN_ABI, alice) as ERC20
    wethContract = new ethers.Contract(MAINNET_WETH.address, WETH_ABI, alice) as IWETH
    permit2 = PERMIT2.connect(alice) as IPermit2
    router = (await deployUniversalRouter()).connect(alice) as UniversalRouter
  })

  describe('#execute', () => {
    let planner: RoutePlanner
    const invalidCommand: string = '0x3f'

    beforeEach(async () => {
      planner = new RoutePlanner()
      await daiContract.approve(permit2.address, MAX_UINT)
      await wethContract.approve(permit2.address, MAX_UINT)
      await permit2.approve(MAINNET_DAI.address, router.address, MAX_UINT160, DEADLINE)
      await permit2.approve(MAINNET_WETH.address, router.address, MAX_UINT160, DEADLINE)
    })

    it('reverts if block.timestamp exceeds the deadline', async () => {
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        alice.address,
        1,
        1,
        [MAINNET_DAI.address, MAINNET_WETH.address],
        SOURCE_MSG_SENDER,
      ])
      const invalidDeadline = 10

      const { commands, inputs } = planner

      await expect(
        router['execute(bytes,bytes[],uint256)'](commands, inputs, invalidDeadline)
      ).to.be.revertedWithCustomError(router, 'TransactionDeadlinePassed')
    })

    it('reverts for an invalid command at index 0', async () => {
      const inputs: string[] = ['0x12341234']

      await expect(router['execute(bytes,bytes[],uint256)'](invalidCommand, inputs, DEADLINE))
        .to.be.revertedWithCustomError(router, 'InvalidCommandType')
        .withArgs(parseInt(invalidCommand))
    })

    it('reverts for an invalid command at index 1', async () => {
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        MAINNET_DAI.address,
        MAINNET_WETH.address,
        expandTo18DecimalsBN(1),
      ])
      let commands = planner.commands
      let inputs = planner.inputs

      commands = commands.concat(invalidCommand.slice(2))
      inputs.push('0x21341234')

      await expect(router['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
        .to.be.revertedWithCustomError(router, 'InvalidCommandType')
        .withArgs(parseInt(invalidCommand))
    })

    it('reverts if paying a portion over 100% of contract balance', async () => {
      await daiContract.transfer(router.address, expandTo18DecimalsBN(1))
      planner.addCommand(CommandType.PAY_PORTION, [MAINNET_WETH.address, alice.address, 11_000])
      planner.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, alice.address, 1])
      const { commands, inputs } = planner
      await expect(router['execute(bytes,bytes[])'](commands, inputs)).to.be.revertedWithCustomError(
        router,
        'InvalidBips'
      )
    })

    it('reverts if a malicious contract tries to reenter', async () => {
      // create malicious calldata to sweep ETH out of the router
      planner.addCommand(CommandType.SWEEP, [ETH_ADDRESS, alice.address, 0])
      let { commands, inputs } = planner
      const sweepCalldata = routerInterface.encodeFunctionData('execute(bytes,bytes[])', [commands, inputs])

      const reentrantWETH = await (await ethers.getContractFactory('ReenteringWETH')).deploy()
      router = (await deployUniversalRouter(reentrantWETH.address)).connect(alice) as UniversalRouter
      await reentrantWETH.setParameters(router.address, sweepCalldata)

      planner = new RoutePlanner()
      const value = expandTo18DecimalsBN(1)
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, value])
      ;({ commands, inputs } = planner)

      await expect(router['execute(bytes,bytes[])'](commands, inputs, { value: value })).to.be.revertedWithCustomError(
        reentrantWETH,
        'NotAllowedReenter'
      )
    })
  })
})

describe('UniversalRouter', () => {
  describe('partial fills', async () => {
    let planner: RoutePlanner

    beforeEach(() => {
      planner = new RoutePlanner()
    })

    // TODO need to rewrite these tests for non-NFT commands
    it('reverts if no commands are allowed to revert')
    it('does not revert if failed command allowed to fail')
  })
})
