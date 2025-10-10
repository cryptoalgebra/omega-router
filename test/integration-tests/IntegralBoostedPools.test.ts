import type { Contract } from '@ethersproject/contracts'
import { expect } from './shared/expect'
import { BigNumber, BigNumberish } from 'ethers'
import { IPermit2, UniversalRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json';
import {
  resetFork,
  BASE_WETH,
  BASE_USDC,
  BASE_DAI,
  PERMIT2,
  BASE_DAI_WHALE,
  BASE_WA_WETH,
  BASE_WM_USDC,
  INTEGRAL_NFT_POSITION_MANAGER
} from './shared/mainnetForkHelpers'
import {
  ADDRESS_THIS,
  BASE_ALICE_ADDRESS,
  ZERO_ADDRESS,
  DEADLINE,
  MAX_UINT,
  MAX_UINT160,
  MSG_SENDER,
  SOURCE_MSG_SENDER,
  SOURCE_ROUTER,
  CONTRACT_BALANCE,
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployUniversalRouter from './shared/deployUniversalRouter'
import { RoutePlanner, CommandType } from './shared/planner'
import hre from 'hardhat'
import {
  encodePathExactInput,
  encodePathExactInputIntegral,
  encodePathExactOutputIntegral
} from './shared/swapRouter02Helpers'
import { executeRouter, DEX } from './shared/executeRouter'
import { getPermitSignature, PermitSingle } from './shared/protocolHelpers/permit2'
import {ADDRESS_ZERO} from "@uniswap/v3-sdk";
import {encodePriceSqrt} from '../../lib/v3-periphery/test/shared/encodePriceSqrt';
import {getMinTick, getMaxTick} from '../../lib/v3-periphery/test/shared/ticks';
const { ethers } = hre

describe('Algebra Integral Boosted Pools Tests:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let usdcContract: Contract
  let wethContract: Contract
  let wWETHContract: Contract
  let wUSDCContract: Contract
  let daiContract: Contract
  let planner: RoutePlanner

  const amountInUSD: BigNumber = expandTo6DecimalsBN(500)
  const amountInMaxUSD: BigNumber = expandTo6DecimalsBN(5000)
  const amountOutETH: BigNumber = expandTo18DecimalsBN(1)

  const amountInETH: BigNumber = expandTo18DecimalsBN(0.2)
  const amountInMaxETH: BigNumber = expandTo18DecimalsBN(1.2)
  const amountOutUSD: BigNumber = expandTo6DecimalsBN(4400)

  beforeEach(async () => {
    await resetFork(
      36274285,
      `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`
    )
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_ALICE_ADDRESS],
    })
    alice = await ethers.getSigner(BASE_ALICE_ADDRESS)
    bob = (await ethers.getSigners())[1]
    usdcContract = new ethers.Contract(BASE_USDC.address, TOKEN_ABI, bob)
    wethContract = new ethers.Contract(BASE_WETH.address, TOKEN_ABI, bob)
    daiContract = new ethers.Contract(BASE_DAI.address, TOKEN_ABI, bob)
    wWETHContract = new ethers.Contract(BASE_WA_WETH.address, ERC4626_ABI, bob)
    wUSDCContract = new ethers.Contract(BASE_WM_USDC.address, ERC4626_ABI, bob)
    permit2 = PERMIT2.connect(bob) as IPermit2
    router = (await deployUniversalRouter(BASE_WETH.address)) as UniversalRouter
    planner = new RoutePlanner()

    // alice gives bob some tokens
    await usdcContract.connect(alice).transfer(bob.address, expandTo6DecimalsBN(100000))
    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))

    const usdcWhale = await ethers.getSigner(BASE_DAI_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_DAI_WHALE],
    })
    await daiContract.connect(usdcWhale).transfer(bob.address, expandTo18DecimalsBN(100000))

    // Bob max-approves the permit2 contract to access his DAI and WETH
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)

    // for these tests Bob gives the router max approval on permit2
    await permit2.approve(BASE_USDC.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_DAI.address, router.address, MAX_UINT160, DEADLINE)

    // Get wrapped tokens for the LP
    await wethContract.connect(alice).approve(BASE_WA_WETH.address, MAX_UINT)
    await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)

    console.log('before deposit')
    await wWETHContract.connect(alice).deposit(expandTo18DecimalsBN(21.4), alice.address)
    await wUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(90000), alice.address)

    const wWETHAmount = await wWETHContract.balanceOf(alice.address)
    const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)
    console.log('before create pool')
    console.log(wWETHAmount, wUSDCAmount, encodePriceSqrt(wUSDCAmount, wWETHAmount))
    // create V3 pool with ERC4626 tokens
    await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
      wUSDCContract.address,
      wWETHContract.address,
      ADDRESS_ZERO,
      encodePriceSqrt(wWETHAmount, wUSDCAmount),
      '0x'
    )

    console.log('pool created')

    // add liq to the pool
    await wWETHContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
    await wUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

    await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
      token0: wUSDCContract.address,
      token1: wWETHContract.address,
      deployer: ADDRESS_ZERO,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      amount0Desired: wUSDCAmount,
      amount1Desired: wWETHAmount,
      amount0Min: 0,
      amount1Min: 0,
      recipient: alice.address,
      deadline: 10000000000000
    })
    console.log('minted')
  })

  const addV3ExactInTrades = (
    planner: RoutePlanner,
    numTrades: BigNumberish,
    amountOutMin: BigNumberish,
    opts: {
      recipient?: string | undefined
      tokens?: string[] | undefined
      tokenSource?: boolean | undefined
      amountIn?: BigNumber | undefined
    } = {
      recipient: undefined,
      tokens: [BASE_USDC.address, BASE_WETH.address],
      tokenSource: SOURCE_MSG_SENDER,
      amountIn: amountInUSD
    }
  ) => {
    const path = encodePathExactInputIntegral(opts.tokens ?? [BASE_USDC.address, BASE_WETH.address])
    for (let i = 0; i < numTrades; i++) {
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        opts.recipient ?? MSG_SENDER,
        opts.amountIn ?? amountInUSD,
        amountOutMin,
        path,
        opts.tokenSource ?? SOURCE_MSG_SENDER,
      ])
    }
  }

  describe('Swaps', () => {
    it('100 USDC wrap -> wmUSDC swap -> waWETH unwrap -> WETH', async () => {
      const v3Tokens = [BASE_WM_USDC.address, BASE_WA_WETH.address]

      const amountInUSDC = expandTo6DecimalsBN(100)
      const expectedAmountOutWaUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC)).mul(99).div(100)

      // 1) transferFrom the funds,
      // 2) perform wrap
      // 3) Uniswap V3 swap using router's balance; amountIn = router's balance
      // 4) perform unwrap; amountIn = router's balance
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        expectedAmountOutWaUSDC
      ])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        encodePathExactInputIntegral(v3Tokens),
        SOURCE_ROUTER,
      ])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        wWETHContract.address,
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0
      ])
      planner.addCommand(CommandType.UNWRAP_WETH, [
        MSG_SENDER,
        0
      ])

      const {ethBalanceBefore, ethBalanceAfter, v3SwapEventArgs, gasSpent} = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      const amountOut = (v3SwapEventArgs?.amount1!).mul(-1)

      // "greater than" because `amountOut` is WA_ETH amount. After UNWRAP it transforms into the greater ETH amount
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gt(amountOut.sub(gasSpent))
    })
  })
})
