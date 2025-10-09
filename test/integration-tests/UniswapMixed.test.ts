import type { Contract } from '@ethersproject/contracts'
import { Pair } from '@uniswap/v2-sdk'
import { expect } from './shared/expect'
import { BigNumber } from 'ethers'
import { IPermit2, UniversalRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json';
import {
  resetFork,
  MAINNET_WETH,
  MAINNET_DAI,
  MAINNET_USDC,
  MAINNET_USDT,
  MAINNET_WA_USDC,
  MAINNET_WA_WETH,
  PERMIT2, UNISWAP_NFT_POSITION_MANAGER,
} from './shared/mainnetForkHelpers'
import {
  ADDRESS_THIS,
  MAINNET_ALICE_ADDRESS,
  CONTRACT_BALANCE,
  DEADLINE,
  MAX_UINT,
  MAX_UINT160,
  MSG_SENDER,
  SOURCE_MSG_SENDER,
  SOURCE_ROUTER,
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployUniversalRouter from './shared/deployUniversalRouter'
import { RoutePlanner, CommandType } from './shared/planner'
import hre from 'hardhat'
import { getPermitBatchSignature } from './shared/protocolHelpers/permit2'
import { encodePathExactInput, encodePathExactOutput } from './shared/swapRouter02Helpers'
import { executeRouter } from './shared/executeRouter'
const { ethers } = hre
import {encodePriceSqrt} from '../../lib/v3-periphery/test/shared/encodePriceSqrt';
import {getMinTick, getMaxTick} from '../../lib/v3-periphery/test/shared/ticks';

const USDC_WHALE = '0x0b07f64ABc342B68AEc57c0936E4B6fD4452967E'

describe('Uniswap V2, V3, and V4 Tests:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let daiContract: Contract
  let wethContract: Contract
  let usdcContract: Contract
  let waWETHContract: Contract
  let waUSDCContract: Contract
  let planner: RoutePlanner


  beforeEach(async () => {
    await resetFork(23432811)

    alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
    bob = (await ethers.getSigners())[1]
    daiContract = new ethers.Contract(MAINNET_DAI.address, TOKEN_ABI, bob)
    wethContract = new ethers.Contract(MAINNET_WETH.address, TOKEN_ABI, bob)
    usdcContract = new ethers.Contract(MAINNET_USDC.address, TOKEN_ABI, bob)
    waWETHContract = new ethers.Contract(MAINNET_WA_WETH.address, ERC4626_ABI, bob)
    waUSDCContract = new ethers.Contract(MAINNET_WA_USDC.address, ERC4626_ABI, bob)
    permit2 = PERMIT2.connect(bob) as IPermit2

    router = (await deployUniversalRouter()).connect(bob) as UniversalRouter
    planner = new RoutePlanner()

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MAINNET_ALICE_ADDRESS],
    })
    // air drop some tokens
    await daiContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(1000000))
    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))

    const usdcWhale = await ethers.getSigner(USDC_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_WHALE],
    })
    await usdcContract.connect(usdcWhale).transfer(alice.address, expandTo6DecimalsBN(50000000))
    await usdcContract.connect(usdcWhale).transfer(bob.address, expandTo6DecimalsBN(50000000))

    // Bob max-approves the permit2 contract to access his DAI and WETH
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)

    // for these tests Bob gives the router max approval on permit2
    await permit2.approve(MAINNET_DAI.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(MAINNET_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(MAINNET_USDC.address, router.address, MAX_UINT160, DEADLINE)
  })

  describe('Interleaving routes', () => {
    it('V3, then V2', async () => {
      const v3Tokens = [MAINNET_DAI.address, MAINNET_USDC.address]
      const v2Tokens = [MAINNET_USDC.address, MAINNET_WETH.address]
      const v3AmountIn: BigNumber = expandTo18DecimalsBN(5)
      const v3AmountOutMin = 0
      const v2AmountOutMin = expandTo18DecimalsBN(0.0005)

      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        Pair.getAddress(MAINNET_USDC, MAINNET_WETH),
        v3AmountIn,
        v3AmountOutMin,
        encodePathExactInput(v3Tokens),
        SOURCE_MSG_SENDER,
      ])
      // amountIn of 0 because the USDC is already in the pair
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, 0, v2AmountOutMin, v2Tokens, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter, v2SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const { amount1Out: wethTraded } = v2SwapEventArgs!
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.eq(wethTraded)
    })

    it('V2, then V3', async () => {
      const v2Tokens = [MAINNET_DAI.address, MAINNET_USDC.address]
      const v3Tokens = [MAINNET_USDC.address, MAINNET_WETH.address]
      const v2AmountIn: BigNumber = expandTo18DecimalsBN(5)
      const v2AmountOutMin = 0 // doesnt matter how much USDC it is, what matters is the end of the trade
      const v3AmountOutMin = expandTo18DecimalsBN(0.0005)

      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        v2AmountIn,
        v2AmountOutMin,
        v2Tokens,
        SOURCE_MSG_SENDER,
      ])
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        MSG_SENDER,
        CONTRACT_BALANCE,
        v3AmountOutMin,
        encodePathExactInput(v3Tokens),
        SOURCE_ROUTER,
      ])

      const { wethBalanceBefore, wethBalanceAfter, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const { amount1: wethTraded } = v3SwapEventArgs!
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.eq(wethTraded.mul(-1))
    })
  })

  describe('Split routes', () => {
    it('ERC20 --> ERC20 split V2 and V2 different routes, each two hop, with explicit permit transfer from', async () => {
      const route1 = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]
      const route2 = [MAINNET_DAI.address, MAINNET_USDT.address, MAINNET_WETH.address]
      const v2AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v2AmountIn2: BigNumber = expandTo18DecimalsBN(30)
      const minAmountOut1 = expandTo18DecimalsBN(0.0045)
      const minAmountOut2 = expandTo18DecimalsBN(0.006)

      // 1) transfer funds into DAI-USDC and DAI-USDT pairs to trade
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [MAINNET_DAI.address, Pair.getAddress(MAINNET_DAI, MAINNET_USDC), v2AmountIn1])
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [MAINNET_DAI.address, Pair.getAddress(MAINNET_DAI, MAINNET_USDT), v2AmountIn2])

      // 2) trade route1 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, 0, minAmountOut1, route1, SOURCE_MSG_SENDER])
      // 3) trade route2 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, 0, minAmountOut2, route2, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut1.add(minAmountOut2))
    })

    it('ERC20 --> ERC20 split V2 and V2 different routes, each two hop, with explicit permit transfer from batch', async () => {
      const route1 = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]
      const route2 = [MAINNET_DAI.address, MAINNET_USDT.address, MAINNET_WETH.address]
      const v2AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v2AmountIn2: BigNumber = expandTo18DecimalsBN(30)
      const minAmountOut1 = expandTo18DecimalsBN(0.0045)
      const minAmountOut2 = expandTo18DecimalsBN(0.006)

      const BATCH_TRANSFER = [
        {
          from: bob.address,
          to: Pair.getAddress(MAINNET_DAI, MAINNET_USDC),
          amount: v2AmountIn1,
          token: MAINNET_DAI.address,
        },
        {
          from: bob.address,
          to: Pair.getAddress(MAINNET_DAI, MAINNET_USDT),
          amount: v2AmountIn2,
          token: MAINNET_DAI.address,
        },
      ]

      // 1) transfer funds into DAI-USDC and DAI-USDT pairs to trade
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM_BATCH, [BATCH_TRANSFER])

      // 2) trade route1 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, 0, minAmountOut1, route1, SOURCE_MSG_SENDER])
      // 3) trade route2 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [MSG_SENDER, 0, minAmountOut2, route2, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut1.add(minAmountOut2))
    })

    it('ERC20 --> ERC20 split V2 and V2 different routes, each two hop, without explicit permit', async () => {
      const route1 = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]
      const route2 = [MAINNET_DAI.address, MAINNET_USDT.address, MAINNET_WETH.address]
      const v2AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v2AmountIn2: BigNumber = expandTo18DecimalsBN(30)
      const minAmountOut1 = expandTo18DecimalsBN(0.0045)
      const minAmountOut2 = expandTo18DecimalsBN(0.006)

      // 1) trade route1 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        v2AmountIn1,
        minAmountOut1,
        route1,
        SOURCE_MSG_SENDER,
      ])
      // 2) trade route2 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        v2AmountIn2,
        minAmountOut2,
        route2,
        SOURCE_MSG_SENDER,
      ])

      const { wethBalanceBefore, wethBalanceAfter } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut1.add(minAmountOut2))
    })

    it('PERMIT2 batch can silently fail', async () => {
      const v2AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v2AmountIn2: BigNumber = expandTo18DecimalsBN(5)

      const BATCH_PERMIT = {
        details: [
          {
            token: MAINNET_DAI.address,
            amount: v2AmountIn1,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
          {
            token: MAINNET_WETH.address,
            amount: v2AmountIn2,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
        ],
        spender: router.address,
        sigDeadline: DEADLINE,
      }

      const sig = await getPermitBatchSignature(BATCH_PERMIT, bob, permit2)

      // transfer funds into DAI-USDC and DAI-USDT pairs to trade
      // do not allow revert
      planner.addCommand(CommandType.PERMIT2_PERMIT_BATCH, [BATCH_PERMIT, sig])

      // allow revert
      planner.addCommand(CommandType.PERMIT2_PERMIT_BATCH, [BATCH_PERMIT, sig], true)

      let nonce = (await permit2.allowance(bob.address, MAINNET_DAI.address, router.address)).nonce
      expect(nonce).to.eq(0)

      await executeRouter(planner, bob, router, wethContract, daiContract, usdcContract)

      nonce = (await permit2.allowance(bob.address, MAINNET_DAI.address, router.address)).nonce
      expect(nonce).to.eq(1)
    })

    it('ERC20 --> ERC20 split V2 and V2 different routes, different input tokens, each two hop, with batch permit', async () => {
      const route1 = [MAINNET_DAI.address, MAINNET_WETH.address, MAINNET_USDC.address]
      const route2 = [MAINNET_WETH.address, MAINNET_DAI.address, MAINNET_USDC.address]
      const v2AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v2AmountIn2: BigNumber = expandTo18DecimalsBN(5)
      const minAmountOut1 = BigNumber.from(0.005 * 10 ** 6)
      const minAmountOut2 = BigNumber.from(0.0075 * 10 ** 6)

      const BATCH_PERMIT = {
        details: [
          {
            token: MAINNET_DAI.address,
            amount: v2AmountIn1,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
          {
            token: MAINNET_WETH.address,
            amount: v2AmountIn2,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
        ],
        spender: router.address,
        sigDeadline: DEADLINE,
      }

      const sig = await getPermitBatchSignature(BATCH_PERMIT, bob, permit2)

      // 1) transfer funds into DAI-USDC and DAI-USDT pairs to trade
      planner.addCommand(CommandType.PERMIT2_PERMIT_BATCH, [BATCH_PERMIT, sig])

      // 2) trade route1 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        v2AmountIn1,
        minAmountOut1,
        route1,
        SOURCE_MSG_SENDER,
      ])
      // 3) trade route2 and return tokens to bob
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        MSG_SENDER,
        v2AmountIn2,
        minAmountOut2,
        route2,
        SOURCE_MSG_SENDER,
      ])

      const { usdcBalanceBefore, usdcBalanceAfter } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gte(minAmountOut1.add(minAmountOut2))
    })

    it('ERC20 --> ERC20 V3 trades with different input tokens with batch permit and batch transfer', async () => {
      const route1 = [MAINNET_DAI.address, MAINNET_WETH.address]
      const route2 = [MAINNET_WETH.address, MAINNET_USDC.address]
      const v3AmountIn1: BigNumber = expandTo18DecimalsBN(20)
      const v3AmountIn2: BigNumber = expandTo18DecimalsBN(5)
      const minAmountOut1WETH = BigNumber.from(0)
      const minAmountOut1USDC = BigNumber.from(0.005 * 10 ** 6)
      const minAmountOut2USDC = BigNumber.from(0.0075 * 10 ** 6)

      const BATCH_PERMIT = {
        details: [
          {
            token: MAINNET_DAI.address,
            amount: v3AmountIn1,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
          {
            token: MAINNET_WETH.address,
            amount: v3AmountIn2,
            expiration: 0, // expiration of 0 is block.timestamp
            nonce: 0, // this is his first trade
          },
        ],
        spender: router.address,
        sigDeadline: DEADLINE,
      }

      const BATCH_TRANSFER = [
        {
          from: bob.address,
          to: router.address,
          amount: v3AmountIn1,
          token: MAINNET_DAI.address,
        },
        {
          from: bob.address,
          to: router.address,
          amount: v3AmountIn2,
          token: MAINNET_WETH.address,
        },
      ]

      const sig = await getPermitBatchSignature(BATCH_PERMIT, bob, permit2)

      // 1) permit dai and weth to be spent by router
      planner.addCommand(CommandType.PERMIT2_PERMIT_BATCH, [BATCH_PERMIT, sig])

      // 2) transfer dai and weth into router to use contract balance
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM_BATCH, [BATCH_TRANSFER])

      // v3SwapExactInput(recipient, amountIn, amountOutMin, path, payer);

      // 2) trade route1 and return tokens to router for the second trade
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        minAmountOut1WETH,
        encodePathExactInput(route1),
        SOURCE_ROUTER,
      ])
      // 3) trade route2 and return tokens to bob
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        MSG_SENDER,
        CONTRACT_BALANCE,
        minAmountOut1USDC.add(minAmountOut2USDC),
        encodePathExactInput(route2),
        SOURCE_ROUTER,
      ])

      const { usdcBalanceBefore, usdcBalanceAfter } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gte(minAmountOut1USDC.add(minAmountOut2USDC))
    })

    it('ERC20 --> ERC20 split V2 and V3, one hop', async () => {
      const tokens = [MAINNET_DAI.address, MAINNET_WETH.address]
      const v2AmountIn: BigNumber = expandTo18DecimalsBN(2)
      const v3AmountIn: BigNumber = expandTo18DecimalsBN(3)
      const minAmountOut = expandTo18DecimalsBN(0.0005)

      // V2 trades DAI for USDC, sending the tokens back to the router for v3 trade
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [ADDRESS_THIS, v2AmountIn, 0, tokens, SOURCE_MSG_SENDER])
      // V3 trades USDC for WETH, trading the whole balance, with a recipient of Alice
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        v3AmountIn,
        0,
        encodePathExactInput(tokens),
        SOURCE_MSG_SENDER,
      ])
      // aggregate slippage check
      planner.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, MSG_SENDER, minAmountOut])

      const { wethBalanceBefore, wethBalanceAfter, v2SwapEventArgs, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const { amount1Out: wethOutV2 } = v2SwapEventArgs!
      let { amount1: wethOutV3 } = v3SwapEventArgs!

      // expect(daiBalanceBefore.sub(daiBalanceAfter)).to.eq(v2AmountIn.add(v3AmountIn)) // TODO: with permit2 can check from alice's balance
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.eq(wethOutV2.sub(wethOutV3))
    })

    it('ETH --> ERC20 split V2 and V3, one hop', async () => {
      const tokens = [MAINNET_WETH.address, MAINNET_USDC.address]
      const v2AmountIn: BigNumber = expandTo18DecimalsBN(2)
      const v3AmountIn: BigNumber = expandTo18DecimalsBN(3)
      const value = v2AmountIn.add(v3AmountIn)

      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, value])
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [ADDRESS_THIS, v2AmountIn, 0, tokens, SOURCE_ROUTER])
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        v3AmountIn,
        0,
        encodePathExactInput(tokens),
        SOURCE_MSG_SENDER,
      ])
      // aggregate slippage check
      planner.addCommand(CommandType.SWEEP, [MAINNET_USDC.address, MSG_SENDER, 0.0005 * 10 ** 6])

      const { usdcBalanceBefore, usdcBalanceAfter, v2SwapEventArgs, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        value
      )
      const { amount0Out: usdcOutV2 } = v2SwapEventArgs!
      let { amount0: usdcOutV3 } = v3SwapEventArgs!
      usdcOutV3 = usdcOutV3.mul(-1)
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.eq(usdcOutV2.add(usdcOutV3))
    })

    it('ERC20 --> ETH split V2 and V3, one hop', async () => {
      const tokens = [MAINNET_DAI.address, MAINNET_WETH.address]
      const v2AmountIn: BigNumber = expandTo18DecimalsBN(20)
      const v3AmountIn: BigNumber = expandTo18DecimalsBN(30)

      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [ADDRESS_THIS, v2AmountIn, 0, tokens, SOURCE_MSG_SENDER])
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        v3AmountIn,
        0,
        encodePathExactInput(tokens),
        SOURCE_MSG_SENDER,
      ])
      // aggregate slippage check
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, expandTo18DecimalsBN(0.0005)])

      const { ethBalanceBefore, ethBalanceAfter, gasSpent, v2SwapEventArgs, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )
      const { amount1Out: wethOutV2 } = v2SwapEventArgs!
      let { amount1: wethOutV3 } = v3SwapEventArgs!
      wethOutV3 = wethOutV3.mul(-1)

      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.eq(wethOutV2.add(wethOutV3).sub(gasSpent))
    })

    it('ERC20 --> ETH split V2 and V3, exactOut, one hop', async () => {
      const tokens = [MAINNET_DAI.address, MAINNET_WETH.address]
      const v2AmountOut: BigNumber = expandTo18DecimalsBN(0.5)
      const v3AmountOut: BigNumber = expandTo18DecimalsBN(1)
      const path = encodePathExactOutput(tokens)
      const maxAmountIn = expandTo18DecimalsBN(4205)
      const fullAmountOut = v2AmountOut.add(v3AmountOut)

      planner.addCommand(CommandType.V2_SWAP_EXACT_OUT, [
        ADDRESS_THIS,
        v2AmountOut,
        maxAmountIn,
        [MAINNET_DAI.address, MAINNET_WETH.address],
        SOURCE_MSG_SENDER,
      ])
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_OUT, [
        ADDRESS_THIS,
        v3AmountOut,
        maxAmountIn,
        path,
        SOURCE_MSG_SENDER,
      ])
      // aggregate slippage check
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, fullAmountOut])

      const { ethBalanceBefore, ethBalanceAfter, gasSpent } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract
      )

      // TODO: permit2 test alice doesn't send more than maxAmountIn DAI
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.eq(fullAmountOut.sub(gasSpent))
    })

    describe('Batch reverts', () => {
      let subplan: RoutePlanner
      const planOneTokens = [MAINNET_DAI.address, MAINNET_WETH.address]
      const planTwoTokens = [MAINNET_USDC.address, MAINNET_WETH.address]
      const planOneV2AmountIn: BigNumber = expandTo18DecimalsBN(2)
      const planOneV3AmountIn: BigNumber = expandTo18DecimalsBN(3)
      const planTwoV3AmountIn = expandTo6DecimalsBN(5)

      beforeEach(async () => {
        subplan = new RoutePlanner()
      })

      it('2 sub-plans, neither fails', async () => {
        // first split route sub-plan. DAI->WETH, 2 routes on V2 and V3.
        const planOneWethMinOut = expandTo18DecimalsBN(0.0005)

        // V2 trades DAI for USDC, sending the tokens back to the router for v3 trade
        subplan.addCommand(CommandType.V2_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV2AmountIn,
          0,
          planOneTokens,
          SOURCE_MSG_SENDER,
        ])
        // V3 trades USDC for WETH, trading the whole balance, with a recipient of Alice
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV3AmountIn,
          0,
          encodePathExactInput(planOneTokens),
          SOURCE_MSG_SENDER,
        ])
        // aggregate slippage check
        subplan.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, MSG_SENDER, planOneWethMinOut])

        // add the subplan to the main planner
        planner.addSubPlan(subplan)
        subplan = new RoutePlanner()

        // second split route sub-plan. USDC->WETH, 1 route on V3
        const wethMinAmountOut2 = expandTo18DecimalsBN(0.0005)

        // Add the trade to the sub-plan
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          MSG_SENDER,
          planTwoV3AmountIn,
          wethMinAmountOut2,
          encodePathExactInput(planTwoTokens),
          SOURCE_MSG_SENDER,
        ])

        // add the second subplan to the main planner
        planner.addSubPlan(subplan)

        const { usdcBalanceBefore, usdcBalanceAfter, daiBalanceBefore, daiBalanceAfter } = await executeRouter(
          planner,
          bob,
          router,
          wethContract,
          daiContract,
          usdcContract
        )

        expect(daiBalanceBefore.sub(daiBalanceAfter)).to.eq(planOneV2AmountIn.add(planOneV3AmountIn))
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.eq(planTwoV3AmountIn)
      })

      it('2 sub-plans, the first fails', async () => {
        // first split route sub-plan. DAI->WETH, 2 routes on V2 and V3.
        // FAIL: large weth amount out to cause a failure
        const planOneWethMinOut = expandTo18DecimalsBN(1)

        // V2 trades DAI for USDC, sending the tokens back to the router for v3 trade
        subplan.addCommand(CommandType.V2_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV2AmountIn,
          0,
          planOneTokens,
          SOURCE_MSG_SENDER,
        ])
        // V3 trades USDC for WETH, trading the whole balance, with a recipient of Alice
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV3AmountIn,
          0,
          encodePathExactInput(planOneTokens),
          SOURCE_MSG_SENDER,
        ])
        // aggregate slippage check
        subplan.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, MSG_SENDER, planOneWethMinOut])

        // add the subplan to the main planner
        planner.addSubPlan(subplan)
        subplan = new RoutePlanner()

        // second split route sub-plan. USDC->WETH, 1 route on V3
        const wethMinAmountOut2 = expandTo18DecimalsBN(0.0005)

        // Add the trade to the sub-plan
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          MSG_SENDER,
          planTwoV3AmountIn,
          wethMinAmountOut2,
          encodePathExactInput(planTwoTokens),
          SOURCE_MSG_SENDER,
        ])

        // add the second subplan to the main planner
        planner.addSubPlan(subplan)

        const { usdcBalanceBefore, usdcBalanceAfter, daiBalanceBefore, daiBalanceAfter } = await executeRouter(
          planner,
          bob,
          router,
          wethContract,
          daiContract,
          usdcContract
        )

        // dai balance should be unchanged as the weth sweep failed
        expect(daiBalanceBefore).to.eq(daiBalanceAfter)

        // usdc is the second trade so the balance has changed
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.eq(planTwoV3AmountIn)
      })

      it('2 sub-plans, both fail but the transaction succeeds', async () => {
        // first split route sub-plan. DAI->WETH, 2 routes on V2 and V3.
        // FAIL: large amount out to cause the swap to revert
        const planOneWethMinOut = expandTo18DecimalsBN(1)

        // V2 trades DAI for USDC, sending the tokens back to the router for v3 trade
        subplan.addCommand(CommandType.V2_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV2AmountIn,
          0,
          planOneTokens,
          SOURCE_MSG_SENDER,
        ])
        // V3 trades USDC for WETH, trading the whole balance, with a recipient of Alice
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV3AmountIn,
          0,
          encodePathExactInput(planOneTokens),
          SOURCE_MSG_SENDER,
        ])
        // aggregate slippage check
        subplan.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, MSG_SENDER, planOneWethMinOut])

        // add the subplan to the main planner
        planner.addSubPlan(subplan)
        subplan = new RoutePlanner()

        // second split route sub-plan. USDC->WETH, 1 route on V3
        // FAIL: large amount out to cause the swap to revert
        const wethMinAmountOut2 = expandTo18DecimalsBN(1)

        // Add the trade to the sub-plan
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          MSG_SENDER,
          planTwoV3AmountIn,
          wethMinAmountOut2,
          encodePathExactInput(planTwoTokens),
          SOURCE_MSG_SENDER,
        ])

        // add the second subplan to the main planner
        planner.addSubPlan(subplan)

        const { usdcBalanceBefore, usdcBalanceAfter, daiBalanceBefore, daiBalanceAfter } = await executeRouter(
          planner,
          bob,
          router,
          wethContract,
          daiContract,
          usdcContract
        )

        // dai and usdc balances both unchanged because both trades failed
        expect(daiBalanceBefore).to.eq(daiBalanceAfter)
        expect(usdcBalanceBefore).to.eq(usdcBalanceAfter)
      })

      it('2 sub-plans, second sub plan fails', async () => {
        // first split route sub-plan. DAI->WETH, 2 routes on V2 and V3.
        const planOneWethMinOut = expandTo18DecimalsBN(0.0005)

        // V2 trades DAI for USDC, sending the tokens back to the router for v3 trade
        subplan.addCommand(CommandType.V2_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV2AmountIn,
          0,
          planOneTokens,
          SOURCE_MSG_SENDER,
        ])
        // V3 trades USDC for WETH, trading the whole balance, with a recipient of Alice
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          planOneV3AmountIn,
          0,
          encodePathExactInput(planOneTokens),
          SOURCE_MSG_SENDER,
        ])
        // aggregate slippage check
        subplan.addCommand(CommandType.SWEEP, [MAINNET_WETH.address, MSG_SENDER, planOneWethMinOut])

        // add the subplan to the main planner
        planner.addSubPlan(subplan)
        subplan = new RoutePlanner()

        // second split route sub-plan. USDC->WETH, 1 route on V3
        // FAIL: large amount out to cause the swap to revert
        const wethMinAmountOut2 = expandTo18DecimalsBN(1)

        // Add the trade to the sub-plan
        subplan.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
          MSG_SENDER,
          planTwoV3AmountIn,
          wethMinAmountOut2,
          encodePathExactInput(planTwoTokens),
          SOURCE_MSG_SENDER,
        ])

        // add the second subplan to the main planner
        planner.addSubPlan(subplan)

        const { usdcBalanceBefore, usdcBalanceAfter, daiBalanceBefore, daiBalanceAfter } = await executeRouter(
          planner,
          bob,
          router,
          wethContract,
          daiContract,
          usdcContract
        )

        // dai balance has changed as this trade should succeed
        expect(daiBalanceBefore.sub(daiBalanceAfter)).to.eq(planOneV2AmountIn.add(planOneV3AmountIn))

        // usdc is unchanged as the second trade should have failed
        expect(usdcBalanceBefore).to.eq(usdcBalanceAfter)
      })
    })
  })

  describe('Boosted Pools', () => {
    beforeEach(async () => {
      // Get wrapped tokens for the LP
      await wethContract.connect(alice).approve(MAINNET_WA_WETH.address, MAX_UINT)
      await usdcContract.connect(alice).approve(MAINNET_WA_USDC.address, MAX_UINT)

      await waWETHContract.connect(alice).deposit(expandTo18DecimalsBN(100), alice.address)
      await waUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(400000), alice.address)

      const waWETHAmount = await waWETHContract.balanceOf(alice.address)
      const waUSDCAmount = await waUSDCContract.balanceOf(alice.address)

      // create V3 pool with ERC4626 tokens
      await UNISWAP_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        waWETHContract.address,
        waUSDCContract.address,
        3000,
        encodePriceSqrt(waUSDCAmount, waWETHAmount)
      )

      // add liq to the pool
      await waWETHContract.connect(alice).approve(UNISWAP_NFT_POSITION_MANAGER.address, MAX_UINT)
      await waUSDCContract.connect(alice).approve(UNISWAP_NFT_POSITION_MANAGER.address, MAX_UINT)

      await UNISWAP_NFT_POSITION_MANAGER.connect(alice).mint({
        token0: waWETHContract.address,
        token1: waUSDCContract.address,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: waWETHAmount,
        amount1Desired: waUSDCAmount,
        amount0Min: 0,
        amount1Min: 0,
        recipient: alice.address,
        deadline: 10000000000000
      })
    })

    it('100 USDC wrap -> waUSDC swap -> waWETH unwrap -> WETH', async () => {
      const v3Tokens = [MAINNET_WA_USDC.address, MAINNET_WA_WETH.address]

      const amountInUSDC = expandTo6DecimalsBN(100)
      const expectedAmountOutWaUSDC = BigNumber.from(await waUSDCContract.previewDeposit(amountInUSDC)).mul(99).div(100)

      // 1) transferFrom the funds,
      // 2) perform wrap
      // 3) Uniswap V3 swap using router's balance; amountIn = router's balance
      // 4) perform unwrap; amountIn = router's balance
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [MAINNET_USDC.address, router.address, amountInUSDC])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        waUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        expectedAmountOutWaUSDC
      ])
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        encodePathExactInput(v3Tokens),
        SOURCE_ROUTER,
      ])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        waWETHContract.address,
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
        usdcContract
      )

      const amountOut = (v3SwapEventArgs?.amount0!).mul(-1)

      // "greater than" because `amountOut` is WA_ETH amount. After UNWRAP it transforms into the greater ETH amount
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gt(amountOut.sub(gasSpent))
    })
  })
})
