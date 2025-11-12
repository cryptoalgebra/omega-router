import { CommandType, RoutePlanner } from './shared/planner'
import { expect } from './shared/expect'
import { OmegaRouter } from '../../typechain'
import { resetFork, MAINNET_USDC } from './shared/mainnetForkHelpers'
import { MAINNET_ALICE_ADDRESS, DEADLINE } from './shared/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import hre from 'hardhat'
import deployOmegaRouter from './shared/deployOmegaRouter'
import { findCustomErrorSelector } from './shared/parseEvents'
import { BigNumber, Contract } from 'ethers'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
const { ethers } = hre

describe('Check Ownership', () => {
  let alice: SignerWithAddress
  let router: OmegaRouter
  let planner: RoutePlanner

  describe('checks balance ERC20', () => {
    let aliceUSDCBalance: BigNumber
    let usdcContract: Contract

    beforeEach(async () => {
      await resetFork()
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [MAINNET_ALICE_ADDRESS],
      })
      alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
      router = (await deployOmegaRouter()).connect(alice) as OmegaRouter
      usdcContract = new ethers.Contract(MAINNET_USDC.address, TOKEN_ABI, alice)
      aliceUSDCBalance = await usdcContract.balanceOf(MAINNET_ALICE_ADDRESS)
      planner = new RoutePlanner()
    })

    it('passes with sufficient balance', async () => {
      planner.addCommand(CommandType.BALANCE_CHECK_ERC20, [
        MAINNET_ALICE_ADDRESS,
        MAINNET_USDC.address,
        aliceUSDCBalance,
      ])

      const { commands, inputs } = planner
      await expect(router['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE)).to.not.be.reverted
    })

    it('reverts for insufficient balance', async () => {
      const invalidBalance = aliceUSDCBalance.add(1)
      planner.addCommand(CommandType.BALANCE_CHECK_ERC20, [MAINNET_ALICE_ADDRESS, MAINNET_USDC.address, invalidBalance])

      const { commands, inputs } = planner
      const customErrorSelector = findCustomErrorSelector(router.interface, 'BalanceTooLow')
      await expect(router['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
        .to.be.revertedWithCustomError(router, 'ExecutionFailed')
        .withArgs(0, customErrorSelector)
    })
  })
})
