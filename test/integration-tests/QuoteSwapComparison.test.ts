import { expect } from './shared/expect'
import { OmegaRouter, OmegaQuoter, IPermit2 } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import { Contract } from '@ethersproject/contracts'
import {
  resetFork,
  MAINNET_WETH,
  MAINNET_DAI,
  MAINNET_USDC,
  PERMIT2,
  BASE_WETH,
  BASE_DAI,
  BASE_USDC,
  BASE_WM_USDC,
  BASE_WA_WETH,
  INTEGRAL_NFT_POSITION_MANAGER,
  BASE_USDC_WHALE,
  BASE_DAI_WHALE,
} from './shared/mainnetForkHelpers'
import {
  DEADLINE,
  MAX_UINT,
  MAX_UINT160,
  MSG_SENDER,
  SOURCE_MSG_SENDER,
  SOURCE_ROUTER,
  CONTRACT_BALANCE,
  ADDRESS_THIS,
  PERMIT2_ADDRESS,
  UNISWAP_V2_FACTORY_MAINNET,
  UNISWAP_V3_FACTORY_MAINNET,
  UNISWAP_V2_INIT_CODE_HASH_MAINNET,
  UNISWAP_V3_INIT_CODE_HASH_MAINNET,
  INTEGRAL_FACTORY_MAINNET,
  INTEGRAL_POOL_DEPLOYER,
  INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
  INTEGRAL_INIT_CODE_HASH_MAINNET,
  MAINNET_ALICE_ADDRESS,
  BASE_ALICE_ADDRESS,
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CommandType, RoutePlanner } from './shared/planner'
import { QuoterPlanner, QuoterResultParser } from './shared/quoterPlanner'
import {
  encodePathExactInput,
  encodePathExactOutput,
  encodePathExactInputIntegral,
  encodeSingleBoostedPoolExactOutput,
  WrapAction,
} from './shared/swapRouter02Helpers'
import { DEX, executeRouter } from './shared/executeRouter'
import hre from 'hardhat'
import deployOmegaRouter from './shared/deployOmegaRouter'
import { BigNumber } from 'ethers'
import { encodePriceSqrt } from '../../lib/v3-periphery/test/shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../../lib/v3-periphery/test/shared/ticks'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'

const { ethers } = hre

describe('Quote vs Swap Comparison:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: OmegaRouter
  let quoter: OmegaQuoter
  let permit2: IPermit2
  let daiContract: Contract
  let wethContract: Contract
  let usdcContract: Contract

  // Tolerance for quote accuracy (in basis points: 100 = 1%)
  const QUOTE_TOLERANCE_BPS = 1 // 0.01% tolerance

  async function deployQuoter(wethAddress: string): Promise<OmegaQuoter> {
    const quoterParameters = {
      permit2: PERMIT2_ADDRESS,
      weth: wethAddress,
      uniswapV2Factory: UNISWAP_V2_FACTORY_MAINNET,
      uniswapV3Factory: UNISWAP_V3_FACTORY_MAINNET,
      uniswapPairInitCodeHash: UNISWAP_V2_INIT_CODE_HASH_MAINNET,
      uniswapPoolInitCodeHash: UNISWAP_V3_INIT_CODE_HASH_MAINNET,
      integralFactory: INTEGRAL_FACTORY_MAINNET,
      integralPoolDeployer: INTEGRAL_POOL_DEPLOYER,
      integralPosManager: INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
      integralPoolInitCodeHash: INTEGRAL_INIT_CODE_HASH_MAINNET,
    }

    const quoterFactory = await ethers.getContractFactory('OmegaQuoter')
    return (await quoterFactory.deploy(quoterParameters)) as OmegaQuoter
  }

  /**
   * Check if actual amount is within tolerance of quoted amount
   */
  function expectWithinTolerance(actual: BigNumber, quoted: BigNumber, tolerance: number = QUOTE_TOLERANCE_BPS) {
    const difference = actual.sub(quoted).abs()
    const toleranceAmount = quoted.mul(tolerance).div(10000)

    expect(difference).to.be.lte(
      toleranceAmount,
      `Actual amount ${actual.toString()} differs from quoted ${quoted.toString()} by more than ${tolerance / 100}%`
    )
  }

  beforeEach(async () => {
    await resetFork()
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MAINNET_ALICE_ADDRESS],
    })
    alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
    bob = (await ethers.getSigners())[1]

    daiContract = new ethers.Contract(MAINNET_DAI.address, TOKEN_ABI, bob)
    wethContract = new ethers.Contract(MAINNET_WETH.address, TOKEN_ABI, bob)
    usdcContract = new ethers.Contract(MAINNET_USDC.address, TOKEN_ABI, bob)
    permit2 = PERMIT2.connect(bob) as IPermit2

    router = (await deployOmegaRouter()) as OmegaRouter
    quoter = await deployQuoter(MAINNET_WETH.address)

    // Alice gives Bob some tokens
    await daiContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100000))
    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))
    await usdcContract.connect(alice).transfer(bob.address, expandTo6DecimalsBN(100000))

    // Bob approves permit2
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)

    // Bob gives router max approval on permit2
    await permit2.approve(MAINNET_DAI.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(MAINNET_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(MAINNET_USDC.address, router.address, MAX_UINT160, DEADLINE)
  })

  describe('V2 Quote vs Swap', () => {
    it('V2 exactIn: quote matches actual swap result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = [MAINNET_DAI.address, MAINNET_WETH.address]

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV2SwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseV2SwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        amountIn,
        0, // No minimum, we'll check against quote
        path,
        SOURCE_MSG_SENDER,
      ])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`V2 ExactIn - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })

    it('V2 exactOut: quote matches actual swap result', async () => {
      const amountOut = expandTo18DecimalsBN(1)
      const path = [MAINNET_DAI.address, MAINNET_WETH.address]

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV2SwapExactOut(amountOut, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV2ExactOutResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.V2_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOut,
        MAX_UINT, // Max in
        path,
        SOURCE_MSG_SENDER,
      ])

      const { daiBalanceBefore, daiBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmountIn = daiBalanceBefore.sub(daiBalanceAfter)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmountIn, quotedAmountIn)
      console.log(`V2 ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })

    it('V2 multihop: quote matches actual swap result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV2SwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseV2SwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, amountIn, 0, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`V2 Multihop - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
  })

  describe('V3 Quote vs Swap', () => {
    it('V3 exactIn: quote matches actual swap result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV3SwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseV3SwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [MSG_SENDER, amountIn, 0, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`V3 ExactIn - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })

    it('V3 exactOut: quote matches actual swap result', async () => {
      const amountOut = expandTo18DecimalsBN(1)
      const path = encodePathExactOutput([MAINNET_DAI.address, MAINNET_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV3SwapExactOut(amountOut, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOut,
        MAX_UINT,
        path,
        SOURCE_MSG_SENDER,
      ])

      const { daiBalanceBefore, daiBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmountIn = daiBalanceBefore.sub(daiBalanceAfter)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmountIn, quotedAmountIn)
      console.log(`V3 ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })

    it('V3 multihop: quote matches actual swap result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV3SwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseV3SwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [MSG_SENDER, amountIn, 0, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`V3 Multihop - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
  })

  describe('Mixed Routes Quote vs Swap', () => {
    it('V2 -> V3 chain: quote matches actual result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const v2Path = [MAINNET_DAI.address, MAINNET_USDC.address]
      const v3Path = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV2SwapExactIn(amountIn, v2Path)
      quotePlanner.addV3SwapExactIn(CONTRACT_BALANCE, v3Path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)

      // Final output is from V3 swap
      const { amountOut: quotedAmount } = QuoterResultParser.parseV3SwapResult(quoteOutputs[1])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.V2_SWAP_EXACT_IN, [router.address, amountIn, 0, v2Path, SOURCE_MSG_SENDER])
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        MSG_SENDER,
        CONTRACT_BALANCE, // Use router balance
        0,
        v3Path,
        SOURCE_ROUTER,
      ])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount, 100)
      console.log(`V2->V3 Chain - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })

    it('V3 -> V2 chain: quote matches actual result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const v3Path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])
      const v2Path = [MAINNET_WETH.address, MAINNET_USDC.address]

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV3SwapExactIn(amountIn, v3Path)
      quotePlanner.addV2SwapExactIn(CONTRACT_BALANCE, v2Path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)

      // Final output is from V2 swap
      const { amountOut: quotedAmount } = QuoterResultParser.parseV2SwapResult(quoteOutputs[1])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        router.address,
        amountIn,
        0,
        v3Path,
        SOURCE_MSG_SENDER,
      ])
      swapPlanner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        CONTRACT_BALANCE, // Use router balance
        0,
        v2Path,
        SOURCE_ROUTER,
      ])

      const { usdcBalanceBefore, usdcBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = usdcBalanceAfter.sub(usdcBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount, 100)
      console.log(`V3->V2 Chain - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
  })

  describe('Quote as MinAmountOut', () => {
    it('Uses quote with slippage tolerance as minAmountOut', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])
      const slippageTolerance = 50 // 0.5%

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addV3SwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseV3SwapResult(quoteOutputs[0])

      // Calculate minAmountOut with slippage
      const minAmountOut = quotedAmount.mul(10000 - slippageTolerance).div(10000)

      // Execute swap with minAmountOut from quote
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        MSG_SENDER,
        amountIn,
        minAmountOut,
        path,
        SOURCE_MSG_SENDER,
      ])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Actual should be >= minAmountOut
      expect(actualAmount).to.be.gte(minAmountOut)
      console.log(
        `Quote with slippage - Quoted: ${quotedAmount.toString()}, ` +
          `MinOut: ${minAmountOut.toString()}, Actual: ${actualAmount.toString()}`
      )
    })
  })
})

/**
 * Integral Quote vs Swap Comparison (Base Network)
 *
 * Compares quotes with actual swaps for Algebra Integral DEX on Base network.
 * Includes tests for both regular Integral swaps and Boosted Pools (ERC4626).
 */
describe('Integral Quote vs Swap (Base):', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: OmegaRouter
  let quoter: OmegaQuoter
  let permit2: IPermit2
  let daiContract: Contract
  let wethContract: Contract
  let usdcContract: Contract
  let wWETHContract: Contract
  let wUSDCContract: Contract

  const QUOTE_TOLERANCE_BPS = 1 // 0.01% tolerance

  async function deployQuoterBase(wethAddress: string): Promise<OmegaQuoter> {
    const quoterParameters = {
      permit2: PERMIT2_ADDRESS,
      weth: wethAddress,
      uniswapV2Factory: UNISWAP_V2_FACTORY_MAINNET,
      uniswapV3Factory: UNISWAP_V3_FACTORY_MAINNET,
      uniswapPairInitCodeHash: UNISWAP_V2_INIT_CODE_HASH_MAINNET,
      uniswapPoolInitCodeHash: UNISWAP_V3_INIT_CODE_HASH_MAINNET,
      integralFactory: INTEGRAL_FACTORY_MAINNET,
      integralPoolDeployer: INTEGRAL_POOL_DEPLOYER,
      integralPosManager: INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
      integralPoolInitCodeHash: INTEGRAL_INIT_CODE_HASH_MAINNET,
    }

    const quoterFactory = await ethers.getContractFactory('OmegaQuoter')
    return (await quoterFactory.deploy(quoterParameters)) as OmegaQuoter
  }

  function expectWithinTolerance(actual: BigNumber, quoted: BigNumber, tolerance: number = QUOTE_TOLERANCE_BPS) {
    const difference = actual.sub(quoted).abs()
    const toleranceAmount = quoted.mul(tolerance).div(10000)

    expect(difference).to.be.lte(
      toleranceAmount,
      `Actual amount ${actual.toString()} differs from quoted ${quoted.toString()} by more than ${tolerance / 100}%`
    )
  }

  beforeEach(async () => {
    await resetFork(36274285, `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_ALICE_ADDRESS],
    })
    alice = await ethers.getSigner(BASE_ALICE_ADDRESS)
    bob = (await ethers.getSigners())[1]

    daiContract = new ethers.Contract(BASE_DAI.address, TOKEN_ABI, bob)
    wethContract = new ethers.Contract(BASE_WETH.address, TOKEN_ABI, bob)
    usdcContract = new ethers.Contract(BASE_USDC.address, TOKEN_ABI, bob)
    wWETHContract = new ethers.Contract(BASE_WA_WETH.address, ERC4626_ABI, bob)
    wUSDCContract = new ethers.Contract(BASE_WM_USDC.address, ERC4626_ABI, bob)
    permit2 = PERMIT2.connect(bob) as IPermit2

    router = (await deployOmegaRouter(BASE_WETH.address)) as OmegaRouter
    quoter = await deployQuoterBase(BASE_WETH.address)

    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))
    const baseWhale = await ethers.getSigner(BASE_USDC_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_USDC_WHALE],
    })
    await usdcContract.connect(baseWhale).transfer(bob.address, expandTo6DecimalsBN(1000000))
    const baseDaiWhale = await ethers.getSigner(BASE_DAI_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_DAI_WHALE],
    })
    await daiContract.connect(baseDaiWhale).transfer(bob.address, expandTo18DecimalsBN(100000))
    // Bob approves permit2
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)

    // Bob gives router max approval on permit2
    await permit2.approve(BASE_DAI.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_USDC.address, router.address, MAX_UINT160, DEADLINE)
  })

  describe('Integral Quote vs Swap', () => {
    it('Integral exactIn: quote matches actual swap result', async () => {
      const amountIn = expandTo6DecimalsBN(100)
      const path = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [MSG_SENDER, amountIn, 0, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`Integral ExactIn - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })

    it('Integral exactOut: quote matches actual swap result', async () => {
      const amountOut = expandTo18DecimalsBN(0.01)
      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WETH.address,
        WrapAction.NONE,
        BASE_WETH.address,
        ADDRESS_ZERO,
        BASE_USDC.address,
        WrapAction.NONE,
        BASE_USDC.address
      )

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOut, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOut, MAX_UINT, path, MSG_SENDER])

      const { usdcBalanceBefore, usdcBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const actualAmountIn = usdcBalanceBefore.sub(usdcBalanceAfter)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmountIn, quotedAmountIn)
      console.log(`Integral ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })

    it('Integral multihop: quote matches actual swap result', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInputIntegral([BASE_DAI.address, BASE_USDC.address, BASE_WETH.address])

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactIn(amountIn, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [MSG_SENDER, amountIn, 0, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount)
      console.log(`Integral Multihop - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
  })

  describe('Boosted Pools Quote vs Swap', () => {
    beforeEach('provide liquidity to Boosted Pool', async () => {
      // Get wrapped tokens for the LP
      await wethContract.connect(alice).approve(BASE_WA_WETH.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)

      await wWETHContract.connect(alice).deposit(expandTo18DecimalsBN(21.4), alice.address)
      await wUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(90000), alice.address)

      const wWETHAmount = await wWETHContract.balanceOf(alice.address)
      const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)

      // Create V3 pool with ERC4626 tokens
      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        wUSDCContract.address,
        wWETHContract.address,
        ADDRESS_ZERO,
        encodePriceSqrt(wWETHAmount, wUSDCAmount),
        '0x'
      )

      // Add liquidity to the pool
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
        deadline: 10000000000000,
      })
    })

    it('Boosted exactIn: quote matches actual swap with wrap/unwrap', async () => {
      const amountInUSDC = expandTo6DecimalsBN(100)
      const expectedAmountOutWaUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))
        .mul(99)
        .div(100)

      const v3Tokens = [BASE_WM_USDC.address, BASE_WA_WETH.address]
      const path = encodePathExactInputIntegral(v3Tokens)

      // Get quote for the swap portion (wrap -> swap -> unwrap)
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wUSDCContract.address, amountInUSDC)
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, path)
      quotePlanner.addERC4626Unwrap(wWETHContract.address, CONTRACT_BALANCE)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)

      // Parse the unwrap result (last output)
      const { amountOut: quotedAmount } = QuoterResultParser.parseERC4626Result(quoteOutputs[2])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
      swapPlanner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        expectedAmountOutWaUSDC,
      ])
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        path,
        SOURCE_ROUTER,
      ])
      swapPlanner.addCommand(CommandType.ERC4626_UNWRAP, [wWETHContract.address, MSG_SENDER, CONTRACT_BALANCE, 0])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const actualAmount = wethBalanceAfter.sub(wethBalanceBefore)

      // Quote should be very close to actual
      expectWithinTolerance(actualAmount, quotedAmount, 100)
      console.log(`Boosted ExactIn - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })

    it('Boosted exactOut: quote matches actual swap with wrap/unwrap', async () => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxUSDCIn = expandTo6DecimalsBN(50)

      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WETH.address,
        WrapAction.UNWRAP,
        BASE_WA_WETH.address,
        ADDRESS_ZERO,
        BASE_WM_USDC.address,
        WrapAction.WRAP,
        BASE_USDC.address
      )

      // Get quote
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])

      // Execute actual swap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutWETH,
        maxUSDCIn,
        path,
        MSG_SENDER,
      ])

      const { usdcBalanceBefore, usdcBalanceAfter, wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const actualAmountIn = usdcBalanceBefore.sub(usdcBalanceAfter)
      const actualAmountOut = wethBalanceAfter.sub(wethBalanceBefore)

      // Check that we got the expected output
      expect(actualAmountOut).to.be.gte(amountOutWETH)

      // Quote should be very close to actual input
      expectWithinTolerance(actualAmountIn, quotedAmountIn, 100)
      console.log(`Boosted ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })

    it('ERC4626 Wrap: quote matches actual wrap with delay', async () => {
      const amountInWETH = expandTo18DecimalsBN(1)

      // Get quote for wrap
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wWETHContract.address, amountInWETH)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseERC4626Result(quoteOutputs[0])

      await hre.network.provider.send('evm_increaseTime', [7200]) // 1 hour
      await hre.network.provider.send('evm_mine', [])

      // Execute actual wrap
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_WETH.address, router.address, amountInWETH])
      swapPlanner.addCommand(CommandType.ERC4626_WRAP, [
        wWETHContract.address,
        wethContract.address,
        MSG_SENDER,
        amountInWETH,
        0, // No minimum for comparison
      ])

      const wWETHBalanceBefore = await wWETHContract.balanceOf(bob.address)

      await executeRouter(
        swapPlanner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      const wWETHBalanceAfter = await wWETHContract.balanceOf(bob.address)
      const actualAmount = wWETHBalanceAfter.sub(wWETHBalanceBefore)

      // Quote should be very close to actual even with delay
      expectWithinTolerance(actualAmount, quotedAmount, 100) // 1% tolerance
      console.log(`ERC4626 Wrap - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
  })
})
