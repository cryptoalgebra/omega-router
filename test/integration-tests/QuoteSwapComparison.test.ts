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
  encodeBoostedPathExactOutput,
  WrapAction,
  BoostedPoolHop,
} from './shared/swapRouter02Helpers'
import { DEX, executeRouter } from './shared/executeRouter'
import hre from 'hardhat'
import deployOmegaRouter from './shared/deployOmegaRouter'
import { BigNumber, VoidSigner } from 'ethers'
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

      
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wUSDCContract.address, amountInUSDC)
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, path)
      quotePlanner.addERC4626Unwrap(wWETHContract.address, CONTRACT_BALANCE)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)

     
      const { amountOut: quotedAmount } = QuoterResultParser.parseERC4626Result(quoteOutputs[2])

      
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

      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])

      
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

      
      expect(actualAmountOut).to.be.gte(amountOutWETH)

      
      expectWithinTolerance(actualAmountIn, quotedAmountIn, 100)
      console.log(`Boosted ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })

    it('ERC4626 Wrap: quote matches actual wrap with delay', async () => {
      const amountInWETH = expandTo18DecimalsBN(1)

      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wWETHContract.address, amountInWETH)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountOut: quotedAmount } = QuoterResultParser.parseERC4626Result(quoteOutputs[0])

      await hre.network.provider.send('evm_increaseTime', [7200]) // 1 hour
      await hre.network.provider.send('evm_mine', [])

      
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_WETH.address, router.address, amountInWETH])
      swapPlanner.addCommand(CommandType.ERC4626_WRAP, [
        wWETHContract.address,
        wethContract.address,
        MSG_SENDER,
        amountInWETH,
        0, 
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

      
      expectWithinTolerance(actualAmount, quotedAmount, 100) 
      console.log(`ERC4626 Wrap - Quoted: ${quotedAmount.toString()}, Actual: ${actualAmount.toString()}`)
    })
    it('Boosted: ExactOut: wrap ->swap', async() => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxUSDCIn = expandTo6DecimalsBN(50)
      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WA_WETH.address,
        WrapAction.NONE,
        BASE_WA_WETH.address,
        ADDRESS_ZERO,
        BASE_WM_USDC.address,
        WrapAction.WRAP,
        BASE_USDC.address
      )
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])
      
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

      //expect(actualAmountOut).to.be.gte(amountOutWETH)

      
      expectWithinTolerance(actualAmountIn, quotedAmountIn, 100)
      console.log(`Boosted ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)

    })

    it('Boosted: ExactIn: wrap -> swap', async() =>{
      const amountInUSDC = expandTo6DecimalsBN(100)
      const expectedAmountOutWaUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))
        .mul(99)
        .div(100)
        
      const v3Tokens = [BASE_WM_USDC.address, BASE_WA_WETH.address]
      const path = encodePathExactInputIntegral(v3Tokens)

      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wUSDCContract.address, amountInUSDC)
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      
      
      const { amountOut: quotedWrappedAmount } = QuoterResultParser.parseERC4626Result(quoteOutputs[0])
      
      
      const { amountOut: quotedWETHShares } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[1])
      
      
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
        MSG_SENDER, 
        CONTRACT_BALANCE,
        0,
        path,
        SOURCE_ROUTER,
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
      const actualWETHShares = wWETHBalanceAfter.sub(wWETHBalanceBefore)
      
      
      expectWithinTolerance(actualWETHShares, quotedWETHShares, 100)
      console.log(`ExactIn Boosted - Quoted: ${quotedWETHShares.toString()}, Actual: ${actualWETHShares.toString()}`)
      
    })
    it('Boosted: ExactIn: unwrap -> swap', async () => {
      const amountToWrap = expandTo6DecimalsBN(200)
      await usdcContract.connect(bob).approve(BASE_WM_USDC.address, MAX_UINT)
      await wUSDCContract.connect(bob).deposit(amountToWrap, bob.address)
      
      const wrappedBalance = await wUSDCContract.balanceOf(bob.address)
      const amountInWrappedUSDC = expandTo18DecimalsBN(100) 
      
      const v3Path = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])
    
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Unwrap(wUSDCContract.address, amountInWrappedUSDC)
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, v3Path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      
      const { amountOut: quotedUnwrappedUSDC } = QuoterResultParser.parseERC4626Result(quoteOutputs[0])
      
      const { amountOut: quotedWETH } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[1])
    
      const swapPlanner = new RoutePlanner()
      
      await wUSDCContract.connect(bob).transfer(router.address, amountInWrappedUSDC)
      
      swapPlanner.addCommand(CommandType.ERC4626_UNWRAP, [
        wUSDCContract.address,
        ADDRESS_THIS,  
        amountInWrappedUSDC,
        0,
      ])
      
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        MSG_SENDER,  
        CONTRACT_BALANCE,  
        0,
        v3Path,
        SOURCE_ROUTER,
      ])
    
      const wethBalanceBefore = await wethContract.balanceOf(bob.address)
    
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
    
      const wethBalanceAfter = await wethContract.balanceOf(bob.address)
      const actualWETH = wethBalanceAfter.sub(wethBalanceBefore)
    
      expectWithinTolerance(actualWETH, quotedWETH, 100)
      console.log(`Unwrap->Swap - Quoted: ${quotedWETH.toString()}, Actual: ${actualWETH.toString()}`)
    })
    it('Boosted: ExactIn: wmUSDC -> USDC -> wWETH -> WETH', async () => {
      const amountInUSDC = expandTo6DecimalsBN(100)
      
      
      const boostedPath = encodePathExactInputIntegral([BASE_WM_USDC.address, BASE_WA_WETH.address])
    
      // Get quote for full chain (wrap -> swap -> unwrap)
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addERC4626Wrap(wUSDCContract.address, amountInUSDC)
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, boostedPath)
      quotePlanner.addERC4626Unwrap(wWETHContract.address, CONTRACT_BALANCE)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      
      
      const { amountOut: quotedWrappedUSDC } = QuoterResultParser.parseERC4626Result(quoteOutputs[0])
      const { amountOut: quotedWrappedWETH } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[1])
      const { amountOut: quotedWETH } = QuoterResultParser.parseERC4626Result(quoteOutputs[2])
      
      
    
      // Calculate expected wrapped USDC for slippage protection
      const expectedWrappedUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))
        .mul(99)
        .div(100)
    
      
      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
      
      // Wrap USDC -> wUSDC
      swapPlanner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        expectedWrappedUSDC,
      ])
      
      // Swap wUSDC -> wWETH
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        boostedPath,
        SOURCE_ROUTER,
      ])
      
      // Unwrap wWETH -> WETH
      swapPlanner.addCommand(CommandType.ERC4626_UNWRAP, [
        wWETHContract.address,
        MSG_SENDER,
        CONTRACT_BALANCE,
        0,
      ])
    
      const wethBalanceBefore = await wethContract.balanceOf(bob.address)
    
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
    
      const wethBalanceAfter = await wethContract.balanceOf(bob.address)
      const actualWETH = wethBalanceAfter.sub(wethBalanceBefore)
    
      
      expectWithinTolerance(actualWETH, quotedWETH, 100)
      console.log(`USDC->Wrap->Swap->Unwrap->WETH - Quoted: ${quotedWETH.toString()}, Actual: ${actualWETH.toString()}`)
    })
    it('Boosted: Multihop: wrap -> swap -> swap -> swap -> unwrap', async () => {
      const amountIn = expandTo18DecimalsBN(10) 
    
      
      // DAI -> USDC (V3 hop 1)
      const v3Path1 = encodePathExactInputIntegral([BASE_DAI.address, BASE_USDC.address])
      
      // USDC -> wrap to wUSDC (wrap hop 1)
      // wUSDC -> wWETH (boosted pool hop 2)
      const boostedPath = encodePathExactInputIntegral([BASE_WM_USDC.address, BASE_WA_WETH.address])
      
      // wWETH -> unwrap to WETH (unwrap hop 1)
      // WETH -> USDC (V3 hop 3)
      const v3Path2 = encodePathExactInputIntegral([BASE_WETH.address, BASE_USDC.address])
      
      // USDC -> DAI (V3 hop 4 - back to start)
      const v3Path3 = encodePathExactInputIntegral([BASE_USDC.address, BASE_DAI.address])
    
      
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactIn(amountIn, v3Path1)                        // DAI -> USDC
      quotePlanner.addERC4626Wrap(wUSDCContract.address, CONTRACT_BALANCE)          // USDC -> wUSDC
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, boostedPath)            // wUSDC -> wWETH (boosted)
      quotePlanner.addERC4626Unwrap(wWETHContract.address, CONTRACT_BALANCE)        // wWETH -> WETH
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, v3Path2)                // WETH -> USDC
      quotePlanner.addIntegralSwapExactIn(CONTRACT_BALANCE, v3Path3)                // USDC -> DAI
    
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
    
      /
      const { amountOut: quotedUSDC1 } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[0])
      const { amountOut: quotedWrappedUSDC } = QuoterResultParser.parseERC4626Result(quoteOutputs[1])
      const { amountOut: quotedWrappedWETH } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[2])
      const { amountOut: quotedWETH } = QuoterResultParser.parseERC4626Result(quoteOutputs[3])
      const { amountOut: quotedUSDC2 } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[4])
      const { amountOut: quotedFinalDAI } = QuoterResultParser.parseIntegralSwapResult(quoteOutputs[5])
    
    
      
      const expectedWrappedUSDC = BigNumber.from(await wUSDCContract.previewDeposit(quotedUSDC1))
        .mul(99)
        .div(100)
    
      const swapPlanner = new RoutePlanner()
      
      // Hop 1: DAI -> USDC
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        router.address,
        amountIn,
        0,
        v3Path1,
        SOURCE_MSG_SENDER,
      ])
      
      // Hop 2: Wrap USDC -> wUSDC
      swapPlanner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        expectedWrappedUSDC,
      ])
      
      // Hop 3: Swap wUSDC -> wWETH 
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        boostedPath,
        SOURCE_ROUTER,
      ])
      
      // Hop 4: Unwrap wWETH -> WETH
      swapPlanner.addCommand(CommandType.ERC4626_UNWRAP, [
        wWETHContract.address,
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
      ])
      
      // Hop 5: WETH -> USDC
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        router.address,
        CONTRACT_BALANCE,
        0,
        v3Path2,
        SOURCE_ROUTER,
      ])
      
      // Hop 6: USDC -> DAI
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        MSG_SENDER,
        CONTRACT_BALANCE,
        0,
        v3Path3,
        SOURCE_ROUTER,
      ])
    
      const daiBalanceBefore = await daiContract.balanceOf(bob.address)
    
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
    
      const daiBalanceAfter = await daiContract.balanceOf(bob.address)
      const actualFinalDAI = daiBalanceAfter.sub(daiBalanceBefore)
    
      
    
      
      expectWithinTolerance(actualFinalDAI, quotedFinalDAI, 9900) 
    
      
    
      
    })
    it('Boosted: ExactIn: Split routing: wrap -> swap through two different paths', async () => {
      const totalAmountIn = expandTo6DecimalsBN(1000)
      const splitAmount1 = expandTo6DecimalsBN(600) 
      const splitAmount2 = expandTo6DecimalsBN(400) 
    
      // Path 1: USDC -> wrap -> boosted pool -> unwrap -> WETH
      const boostedPath = encodePathExactInputIntegral([BASE_WM_USDC.address, BASE_WA_WETH.address])
      
      // Path 2: USDC -> direct V3 swap -> WETH
      const v3Path = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])
    
      // Quote Path 1: wrap -> boosted swap -> unwrap
      const quotePlanner1 = new QuoterPlanner()
      quotePlanner1.addERC4626Wrap(wUSDCContract.address, splitAmount1)
      quotePlanner1.addIntegralSwapExactIn(CONTRACT_BALANCE, boostedPath)
      quotePlanner1.addERC4626Unwrap(wWETHContract.address, CONTRACT_BALANCE)
      const { commands: cmd1, inputs: inp1 } = quotePlanner1.finalize()
      const outputs1 = await quoter.callStatic.execute(cmd1, inp1)
      const { amountOut: quotedWETH1 } = QuoterResultParser.parseERC4626Result(outputs1[2])
    
      
      const quotePlanner2 = new QuoterPlanner()
      quotePlanner2.addIntegralSwapExactIn(splitAmount2, v3Path)
      const { commands: cmd2, inputs: inp2 } = quotePlanner2.finalize()
      const outputs2 = await quoter.callStatic.execute(cmd2, inp2)
      const { amountOut: quotedWETH2 } = QuoterResultParser.parseIntegralSwapResult(outputs2[0])
    
      const totalQuotedWETH = quotedWETH1.add(quotedWETH2)
      
    
      // Execute Path 1: wrap -> boosted swap -> unwrap
      const expectedWrappedUSDC = BigNumber.from(await wUSDCContract.previewDeposit(splitAmount1))
        .mul(99)
        .div(100)
    
      const swapPlanner1 = new RoutePlanner()
      swapPlanner1.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, splitAmount1])
      swapPlanner1.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        splitAmount1,
        expectedWrappedUSDC,
      ])
      swapPlanner1.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        boostedPath,
        SOURCE_ROUTER,
      ])
      swapPlanner1.addCommand(CommandType.ERC4626_UNWRAP, [
        wWETHContract.address,
        MSG_SENDER,
        CONTRACT_BALANCE,
        0,
      ])
    
      const wethBalanceBefore1 = await wethContract.balanceOf(bob.address)
    
      await executeRouter(
        swapPlanner1,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
    
      const wethBalanceAfter1 = await wethContract.balanceOf(bob.address)
      const actualWETH1 = wethBalanceAfter1.sub(wethBalanceBefore1)
    
      
      const swapPlanner2 = new RoutePlanner()
      swapPlanner2.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        MSG_SENDER,
        splitAmount2,
        0,
        v3Path,
        SOURCE_MSG_SENDER,
      ])
    
      const wethBalanceBefore2 = await wethContract.balanceOf(bob.address)
    
      await executeRouter(
        swapPlanner2,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
    
      const wethBalanceAfter2 = await wethContract.balanceOf(bob.address)
      const actualWETH2 = wethBalanceAfter2.sub(wethBalanceBefore2)
    
      const totalActualWETH = actualWETH1.add(actualWETH2)
    
      
      expectWithinTolerance(actualWETH1, quotedWETH1, 100)
      expectWithinTolerance(actualWETH2, quotedWETH2, 100)
    
      
      expectWithinTolerance(totalActualWETH, totalQuotedWETH, 100)
    
      
    })
    it('Boosted: ExactOut: wmUSDC -> USDC -> WETH', async () => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WETH.address,
        WrapAction.NONE,
        BASE_WETH.address,
        ADDRESS_ZERO,
        BASE_USDC.address,
        WrapAction.UNWRAP,
        BASE_WM_USDC.address
      )
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])
      
      
      
      // Approve permit2
      await wUSDCContract.connect(bob).approve(permit2.address, MAX_UINT)
      permit2.approve(BASE_WM_USDC.address, router.address, MAX_UINT160, DEADLINE)
      // Wrap some USDC to wmUSDC for Bob
      await usdcContract.connect(bob).approve(BASE_WM_USDC.address, MAX_UINT)
      await wUSDCContract.connect(bob).deposit(expandTo6DecimalsBN(100000), bob.address)
      const wmUSDCBalanceBefore = await wUSDCContract.balanceOf(bob.address)


      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutWETH,
        MAX_UINT,
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


      const wmUSDCBalanceAfter = await wUSDCContract.balanceOf(bob.address)
      const actualAmountIn = wmUSDCBalanceBefore.sub(wmUSDCBalanceAfter)

      
      const wethDelta = wethBalanceAfter.sub(wethBalanceBefore) 
      
      expectWithinTolerance(actualAmountIn, quotedAmountIn, 100)
      console.log(`Boosted ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${actualAmountIn.toString()}`)
    })
    it('Boosted: ExactOut: USDC -> WETH -> mWETH', async () => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WA_WETH.address,
        WrapAction.WRAP,
        BASE_WETH.address,
        ADDRESS_ZERO,
        BASE_USDC.address,
        WrapAction.NONE,
        BASE_USDC.address
      )
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, path)
      const { commands: quoteCommands, inputs: quoteInputs } = quotePlanner.finalize()
      const quoteOutputs = await quoter.callStatic.execute(quoteCommands, quoteInputs)
      const { amountIn: quotedAmountIn } = QuoterResultParser.parseV3ExactOutResult(quoteOutputs[0])
      console.log('quotedAmountIn:', quotedAmountIn.toString())

      const wWETHBalanceBefore = await wWETHContract.balanceOf(bob.address)

      const swapPlanner = new RoutePlanner()
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutWETH,
        MAX_UINT,
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
      const usdcDelta = usdcBalanceBefore.sub(usdcBalanceAfter)


      const wWETHBalanceAfter = await wWETHContract.balanceOf(bob.address)

      expect(amountOutWETH.toString()).to.be.eq(wWETHBalanceAfter.toString())
      expectWithinTolerance(usdcDelta, quotedAmountIn, 100)
      console.log(`Boosted ExactOut - Quoted: ${quotedAmountIn.toString()}, Actual: ${usdcDelta.toString()}`)

    })
    
    it('Boosted: ExactOut Multihop: wUSDC ->  -> wWETH -> WETH -> USDC', async () => {
      const amountOutUSDC = expandTo6DecimalsBN(50)
      
      
      const quoteHops: BoostedPoolHop[] = [
        
        {
          tokenOut: BASE_USDC.address,
          wrapOut: WrapAction.NONE,
          poolTokenOut: BASE_USDC.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_WETH.address,
          wrapIn: WrapAction.NONE,           
          tokenIn: BASE_WETH.address,
        },
        
        {
          tokenOut: BASE_WETH.address,       
          wrapOut: WrapAction.UNWRAP,        
          poolTokenOut: BASE_WA_WETH.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_WM_USDC.address, 
          wrapIn: WrapAction.NONE,           
          tokenIn: BASE_WM_USDC.address,
        },
      ]
      
      const quotePath = encodeBoostedPathExactOutput(quoteHops)
      
      
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutUSDC, quotePath)
      const { commands: qCmd, inputs: qInp } = quotePlanner.finalize()
      const qOutputs = await quoter.callStatic.execute(qCmd, qInp)
      const { amountIn: quotedWUSDC } = QuoterResultParser.parseV3ExactOutResult(qOutputs[0])
      
      
      await wUSDCContract.connect(bob).approve(permit2.address, MAX_UINT)
      permit2.approve(BASE_WM_USDC.address, router.address, MAX_UINT160, DEADLINE)
      // Wrap some USDC to wmUSDC for Bob
      await usdcContract.connect(bob).approve(BASE_WM_USDC.address, MAX_UINT)
      await wUSDCContract.connect(bob).deposit(expandTo6DecimalsBN(100000), bob.address)

      
      const swapPlanner = new RoutePlanner()
      
      
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutUSDC,
        quotedWUSDC.mul(105).div(100),  
        quotePath,                       
        SOURCE_MSG_SENDER,
      ])
      
      const wUSDCBalanceBefore = await wUSDCContract.balanceOf(bob.address)
      const usdcBalanceBefore = await usdcContract.balanceOf(bob.address)
      
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
      
      const actualWUSDCIn = wUSDCBalanceBefore.sub(await wUSDCContract.balanceOf(bob.address))
      const actualUSDCOut = (await usdcContract.balanceOf(bob.address)).sub(usdcBalanceBefore)
      
      expect(actualUSDCOut).to.equal(amountOutUSDC)
      expectWithinTolerance(actualWUSDCIn, quotedWUSDC, 100)
      
    })

    it('Boosted: ExactOut Multihop: DAI -> USDC -> wUSDC -> wWETH -> WETH', async () => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)  
      
      
      const quoteHops: BoostedPoolHop[] = [
        
        {
          tokenOut: BASE_WETH.address,
          wrapOut: WrapAction.UNWRAP,        
          poolTokenOut: BASE_WA_WETH.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_WM_USDC.address, 
          wrapIn: WrapAction.NONE,
          tokenIn: BASE_WM_USDC.address,
        },
        
        {
          tokenOut: BASE_WM_USDC.address,    
          wrapOut: WrapAction.WRAP,          
          poolTokenOut: BASE_USDC.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_DAI.address,     
          wrapIn: WrapAction.NONE,
          tokenIn: BASE_DAI.address,
        },
      ]
      
      const quotePath = encodeBoostedPathExactOutput(quoteHops)
      
      
      const quotePlanner = new QuoterPlanner()
      quotePlanner.addIntegralSwapExactOut(amountOutWETH, quotePath)
      const { commands: qCmd, inputs: qInp } = quotePlanner.finalize()
      const qOutputs = await quoter.callStatic.execute(qCmd, qInp)
      const { amountIn: quotedDAI } = QuoterResultParser.parseV3ExactOutResult(qOutputs[0])
      
      
      
      const swapPlanner = new RoutePlanner()
      
      
      swapPlanner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutWETH,
        quotedDAI.mul(105).div(100),  
        quotePath,                     
        SOURCE_MSG_SENDER,
      ])
      
      const daiBalanceBefore = await daiContract.balanceOf(bob.address)
      const wethBalanceBefore = await wethContract.balanceOf(bob.address)
      
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
      
      const actualDAIIn = daiBalanceBefore.sub(await daiContract.balanceOf(bob.address))
      const actualWETHOut = (await wethContract.balanceOf(bob.address)).sub(wethBalanceBefore)
      
      
      expect(actualWETHOut).to.equal(amountOutWETH)  
      expectWithinTolerance(actualDAIIn, quotedDAI, 100)
      
      
      console.log(`  Input: ${actualDAIIn} DAI (quoted: ${quotedDAI})`)
      console.log(`  Output: ${actualWETHOut} WETH (exact: ${amountOutWETH})`)
    })
    it('Split ExactOut: wUSDC splits -> exact WETH -> exact USDC', async () => {
      const desiredWETH = expandTo18DecimalsBN(0.01)    
      const desiredUSDC = expandTo6DecimalsBN(50)       
      
      //  wUSDC -> USDC -> WETH 
      
      const path1 = encodeSingleBoostedPoolExactOutput(
        BASE_WETH.address,           
        WrapAction.UNWRAP,           
        BASE_WA_WETH.address,        
        ADDRESS_ZERO,                
        BASE_WM_USDC.address,        
        WrapAction.NONE,             
        BASE_WM_USDC.address         
      )
      
      
      const quotePlanner1 = new QuoterPlanner()
      quotePlanner1.addIntegralSwapExactOut(desiredWETH, path1)
      const { commands: cmd1, inputs: inp1 } = quotePlanner1.finalize()
      const outputs1 = await quoter.callStatic.execute(cmd1, inp1)
      const { amountIn: quotedWUSDC1 } = QuoterResultParser.parseV3ExactOutResult(outputs1[0])
      
      console.log(`Path 1 Quote: Need ${quotedWUSDC1.toString()} wUSDC to get ${desiredWETH.toString()} WETH`)
      
      //  wUSDC -> wWETH -> WETH -> USDC 
      
      const hops: BoostedPoolHop[] = [
        {
          tokenOut: BASE_USDC.address,
          wrapOut: WrapAction.NONE,
          poolTokenOut: BASE_USDC.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_WETH.address,
          wrapIn: WrapAction.UNWRAP,        
          tokenIn: BASE_WA_WETH.address,    
        },
        
        {
          tokenOut: BASE_WA_WETH.address,   
          wrapOut: WrapAction.NONE,         
          poolTokenOut: BASE_WA_WETH.address,
          deployer: ADDRESS_ZERO,
          poolTokenIn: BASE_WM_USDC.address,
          wrapIn: WrapAction.NONE,          
          tokenIn: BASE_WM_USDC.address,    
        },
      ]
      const path2 = encodeBoostedPathExactOutput(hops)
      
      
      const quotePlanner2 = new QuoterPlanner()
      quotePlanner2.addIntegralSwapExactOut(desiredUSDC, path2)
      const { commands: cmd2, inputs: inp2 } = quotePlanner2.finalize()
      const outputs2 = await quoter.callStatic.execute(cmd2, inp2)
      const { amountIn: quotedWUSDC2 } = QuoterResultParser.parseV3ExactOutResult(outputs2[0])
      
      
      const totalQuotedWUSDC = quotedWUSDC1.add(quotedWUSDC2)

      await wUSDCContract.connect(bob).approve(permit2.address, MAX_UINT)
      permit2.approve(BASE_WM_USDC.address, router.address, MAX_UINT160, DEADLINE)
      // Wrap some USDC to wmUSDC for Bob
      await usdcContract.connect(bob).approve(BASE_WM_USDC.address, MAX_UINT)
      await wUSDCContract.connect(bob).deposit(expandTo6DecimalsBN(100000), bob.address)
      
      //  wUSDC -> WETH 
      const swapPlanner1 = new RoutePlanner()
      swapPlanner1.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        desiredWETH,
        MAX_UINT,                   
        path1,
        MSG_SENDER,
      ])
      
      const wUSDCBalanceBefore1 = await wUSDCContract.balanceOf(bob.address)
      const wethBalanceBefore1 = await wethContract.balanceOf(bob.address)
      
      await executeRouter(
        swapPlanner1,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      
      const wUSDCBalanceAfter1 = await wUSDCContract.balanceOf(bob.address)
      const wethBalanceAfter1 = await wethContract.balanceOf(bob.address)
      
      const actualWUSDC1 = wUSDCBalanceBefore1.sub(wUSDCBalanceAfter1)
      const actualWETH = wethBalanceAfter1.sub(wethBalanceBefore1)
      
      // wUSDC -> USDC 
      const swapPlanner2 = new RoutePlanner()
      swapPlanner2.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        desiredUSDC,
        MAX_UINT,                    
        path2,
        MSG_SENDER,
      ])
      
      const wUSDCBalanceBefore2 = await wUSDCContract.balanceOf(bob.address)
      const usdcBalanceBefore2 = await usdcContract.balanceOf(bob.address)
      
      await executeRouter(
        swapPlanner2,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      
      const wUSDCBalanceAfter2 = await wUSDCContract.balanceOf(bob.address)
      const usdcBalanceAfter2 = await usdcContract.balanceOf(bob.address)
      
      const actualWUSDC2 = wUSDCBalanceBefore2.sub(wUSDCBalanceAfter2)
      const actualUSDC = usdcBalanceAfter2.sub(usdcBalanceBefore2)
      
      const totalActualWUSDC = actualWUSDC1.add(actualWUSDC2)
      
      
      
      expect(actualWETH).to.be.gte(desiredWETH)
      expect(actualUSDC).to.be.gte(desiredUSDC)
      
      
      expectWithinTolerance(actualWUSDC1, quotedWUSDC1, 100)
      expectWithinTolerance(actualWUSDC2, quotedWUSDC2, 100)
      expectWithinTolerance(totalActualWUSDC, totalQuotedWUSDC, 100)
      
      
      console.log(`  Outputs: ${actualWETH.toString()} WETH + ${actualUSDC.toString()} USDC`)
    })
  })
})
