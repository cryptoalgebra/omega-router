import type { Contract } from '@ethersproject/contracts'
import snapshotGasCost from '@uniswap/snapshot-gas-cost'
import { BigNumber } from 'ethers'
import { IPermit2, OmegaRouter } from '../../../typechain'
import { abi as TOKEN_ABI } from '../../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import {
  BASE_DAI,
  BASE_DAI_WHALE,
  BASE_USDC_WHALE,
  BASE_USDC,
  BASE_WA_USDC,
  BASE_WA_WETH,
  BASE_WETH,
  BASE_WM_USDC,
  BASE_SPARK_USDC,
  INTEGRAL_NFT_POSITION_MANAGER,
  PERMIT2,
  resetFork,
} from '../shared/mainnetForkHelpers'
import {
  ADDRESS_THIS,
  BASE_ALICE_ADDRESS,
  CONTRACT_BALANCE,
  DEADLINE,
  MAX_UINT,
  MAX_UINT160,
  MSG_SENDER,
  SOURCE_ROUTER,
  ZERO_ADDRESS,
} from '../shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from '../shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployOmegaRouter from '../shared/deployOmegaRouter'
import { CommandType, RoutePlanner } from '../shared/planner'
import hre from 'hardhat'
import {
  encodePathExactInputIntegral,
  encodeSingleBoostedPoolExactOutput,
  encodeBoostedPathExactOutput,
  WrapAction,
} from '../shared/swapRouter02Helpers'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { encodePriceSqrt } from '../../../lib/v3-periphery/test/shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../../../lib/v3-periphery/test/shared/ticks'

const { ethers } = hre

describe('Integral Boosted Pools Gas Tests', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: OmegaRouter
  let permit2: IPermit2
  let usdcContract: Contract
  let wethContract: Contract
  let wWETHContract: Contract
  let wUSDCContract: Contract
  let daiContract: Contract
  let planner: RoutePlanner

  beforeEach(async () => {
    await resetFork(36274285, `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`)
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
    router = (await deployOmegaRouter(BASE_WETH.address)) as OmegaRouter
    planner = new RoutePlanner()

    // alice gives bob some tokens
    await usdcContract.connect(alice).transfer(bob.address, expandTo6DecimalsBN(100000))
    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))

    const daiWhale = await ethers.getSigner(BASE_DAI_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_DAI_WHALE],
    })
    await daiContract.connect(daiWhale).transfer(bob.address, expandTo18DecimalsBN(100000))

    // Bob max-approves the permit2 contract to access his tokens
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)

    // for these tests Bob gives the router max approval on permit2
    await permit2.approve(BASE_USDC.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(BASE_DAI.address, router.address, MAX_UINT160, DEADLINE)
  })

  describe('exactIn swaps', () => {
    beforeEach('provide liquidity to Boosted Pool', async () => {
      await wethContract.connect(alice).approve(BASE_WA_WETH.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)

      const baseWhale = await ethers.getSigner(BASE_USDC_WHALE)
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [BASE_USDC_WHALE],
      })
      await usdcContract.connect(baseWhale).transfer(alice.address, expandTo6DecimalsBN(1000000))

      await wWETHContract.connect(alice).deposit(expandTo18DecimalsBN(21.4), alice.address)
      await wUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(90000), alice.address)

      const wWETHAmount = await wWETHContract.balanceOf(alice.address)
      const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        wUSDCContract.address,
        wWETHContract.address,
        ADDRESS_ZERO,
        encodePriceSqrt(wWETHAmount, wUSDCAmount),
        '0x'
      )

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

    it('gas: exactIn USDC wrap -> swap -> unwrap WETH', async () => {
      const v3Tokens = [BASE_WM_USDC.address, BASE_WA_WETH.address]
      const amountInUSDC = expandTo6DecimalsBN(100)
      const expectedAmountOutWaUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))
        .mul(99)
        .div(100)

      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        expectedAmountOutWaUSDC,
      ])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        encodePathExactInputIntegral(v3Tokens),
        SOURCE_ROUTER,
      ])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wWETHContract.address, ADDRESS_THIS, CONTRACT_BALANCE, 0])
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, 0])

      const { commands, inputs } = planner
      await snapshotGasCost(router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
    })

    it('gas: exactIn WETH wrap -> swap -> unwrap USDC', async () => {
      const v3Tokens = [BASE_WA_WETH.address, BASE_WM_USDC.address]
      const amountInWeth = expandTo18DecimalsBN(0.02)
      const expectedAmountOutWWeth = BigNumber.from(await wWETHContract.previewDeposit(amountInWeth))
        .mul(99)
        .div(100)

      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_WETH.address, router.address, amountInWeth])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        wWETHContract.address,
        wethContract.address,
        ADDRESS_THIS,
        amountInWeth,
        expectedAmountOutWWeth,
      ])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        ADDRESS_THIS,
        CONTRACT_BALANCE,
        0,
        encodePathExactInputIntegral(v3Tokens),
        SOURCE_ROUTER,
      ])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wUSDCContract.address, MSG_SENDER, CONTRACT_BALANCE, 0])

      const { commands, inputs } = planner
      await snapshotGasCost(router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
    })
  })

  describe('exactOut swaps', () => {
    beforeEach('provide liquidity to Boosted Pool', async () => {
      await wethContract.connect(alice).approve(BASE_WA_WETH.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)

      const baseWhale = await ethers.getSigner(BASE_USDC_WHALE)
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [BASE_USDC_WHALE],
      })
      await usdcContract.connect(baseWhale).transfer(alice.address, expandTo6DecimalsBN(1000000))

      await wWETHContract.connect(alice).deposit(expandTo18DecimalsBN(21.4), alice.address)
      await wUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(90000), alice.address)

      const wWETHAmount = await wWETHContract.balanceOf(alice.address)
      const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        wUSDCContract.address,
        wWETHContract.address,
        ADDRESS_ZERO,
        encodePriceSqrt(wWETHAmount, wUSDCAmount),
        '0x'
      )

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

    it('gas: exactOut single-hop wrap + unwrap', async () => {
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxUSDCIn = expandTo6DecimalsBN(50)

      const path = encodeSingleBoostedPoolExactOutput(
        BASE_WETH.address,
        WrapAction.UNWRAP,
        BASE_WA_WETH.address,
        ZERO_ADDRESS,
        BASE_WM_USDC.address,
        WrapAction.WRAP,
        BASE_USDC.address
      )

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutWETH, maxUSDCIn, path, MSG_SENDER])

      const { commands, inputs } = planner
      await snapshotGasCost(router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
    })

    it('gas: exactOut multihop DAI -> wUSDC -> wWETH -> WETH', async () => {
      planner = new RoutePlanner()

      const daiWhale = await ethers.getSigner(BASE_DAI_WHALE)
      await daiContract.connect(daiWhale).transfer(alice.address, expandTo18DecimalsBN(100000))

      const daiAmount = expandTo18DecimalsBN(50000)
      const wusdcAmount = expandTo6DecimalsBN(50000)

      await daiContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)
      await wUSDCContract.connect(alice).deposit(wusdcAmount, alice.address)
      await wUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        BASE_DAI.address,
        BASE_WM_USDC.address,
        ADDRESS_ZERO,
        encodePriceSqrt(1, 1),
        '0x'
      )

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
        token0: BASE_DAI.address,
        token1: BASE_WM_USDC.address,
        deployer: ADDRESS_ZERO,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: daiAmount,
        amount1Desired: await wUSDCContract.balanceOf(alice.address),
        amount0Min: 0,
        amount1Min: 0,
        recipient: alice.address,
        deadline: 10000000000000,
      })

      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxDAIIn = expandTo18DecimalsBN(50)

      const path = encodeBoostedPathExactOutput([
        {
          tokenOut: BASE_WETH.address,
          wrapOut: WrapAction.UNWRAP,
          poolTokenOut: BASE_WA_WETH.address,
          deployer: ZERO_ADDRESS,
          poolTokenIn: BASE_WM_USDC.address,
          wrapIn: WrapAction.NONE,
          tokenIn: BASE_WM_USDC.address,
        },
        {
          tokenOut: BASE_WM_USDC.address,
          wrapOut: WrapAction.NONE,
          poolTokenOut: BASE_WM_USDC.address,
          deployer: ZERO_ADDRESS,
          poolTokenIn: BASE_DAI.address,
          wrapIn: WrapAction.NONE,
          tokenIn: BASE_DAI.address,
        },
      ])

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutWETH, maxDAIIn, path, MSG_SENDER])

      const { commands, inputs } = planner
      await snapshotGasCost(router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
    })

    it('gas: exactOut multihop with vault transition', async () => {
      planner = new RoutePlanner()

      const waUSDCContract = new ethers.Contract(BASE_WA_USDC.address, ERC4626_ABI, bob)
      const spUSDCContract = new ethers.Contract(BASE_SPARK_USDC.address, ERC4626_ABI, bob)
      const wmUSDCContract = new ethers.Contract(BASE_WM_USDC.address, ERC4626_ABI, bob)

      await usdcContract.connect(alice).approve(BASE_WA_USDC.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_SPARK_USDC.address, MAX_UINT)

      const spUSDCLiq = expandTo6DecimalsBN(50000)
      const waUSDCLiq = expandTo6DecimalsBN(50000)
      const wWETHLiq = expandTo18DecimalsBN(10)

      await spUSDCContract.connect(alice).deposit(spUSDCLiq, alice.address)
      await waUSDCContract.connect(alice).deposit(waUSDCLiq, alice.address)
      await wmUSDCContract.connect(alice).deposit(waUSDCLiq, alice.address)

      await spUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
      await waUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

      // Pool 1: spUSDC / wmUSDC
      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        BASE_SPARK_USDC.address < BASE_WM_USDC.address ? BASE_SPARK_USDC.address : BASE_WM_USDC.address,
        BASE_SPARK_USDC.address < BASE_WM_USDC.address ? BASE_WM_USDC.address : BASE_SPARK_USDC.address,
        ADDRESS_ZERO,
        encodePriceSqrt(1, 1),
        '0x'
      )
      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
        token0: BASE_SPARK_USDC.address < BASE_WM_USDC.address ? BASE_SPARK_USDC.address : BASE_WM_USDC.address,
        token1: BASE_SPARK_USDC.address < BASE_WM_USDC.address ? BASE_WM_USDC.address : BASE_SPARK_USDC.address,
        deployer: ADDRESS_ZERO,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: expandTo18DecimalsBN(40000),
        amount1Desired: expandTo18DecimalsBN(40000),
        amount0Min: 0,
        amount1Min: 0,
        recipient: alice.address,
        deadline: 10000000000000,
      })

      // Pool 2: waUSDC / wWETH
      await spUSDCContract.connect(alice).deposit(spUSDCLiq, alice.address)
      await wWETHContract.connect(alice).deposit(wWETHLiq, alice.address)

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        BASE_WA_USDC.address < BASE_WA_WETH.address ? BASE_WA_USDC.address : BASE_WA_WETH.address,
        BASE_WA_USDC.address < BASE_WA_WETH.address ? BASE_WA_WETH.address : BASE_WA_USDC.address,
        ADDRESS_ZERO,
        encodePriceSqrt(10 ** 18, 4200 * 10 ** 6),
        '0x'
      )

      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
        token0: BASE_WA_USDC.address < BASE_WA_WETH.address ? BASE_WA_USDC.address : BASE_WA_WETH.address,
        token1: BASE_WA_USDC.address < BASE_WA_WETH.address ? BASE_WA_WETH.address : BASE_WA_USDC.address,
        deployer: ADDRESS_ZERO,
        tickLower: getMinTick(192960),
        tickUpper: getMaxTick(192840),
        amount0Desired: await waUSDCContract.balanceOf(alice.address),
        amount1Desired: await wWETHContract.balanceOf(alice.address),
        amount0Min: 0,
        amount1Min: 0,
        recipient: alice.address,
        deadline: 10000000000000,
      })

      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxUSDCIn = expandTo6DecimalsBN(50)

      const path = encodeBoostedPathExactOutput([
        {
          tokenOut: BASE_WETH.address,
          wrapOut: WrapAction.UNWRAP,
          poolTokenOut: BASE_WA_WETH.address,
          deployer: ZERO_ADDRESS,
          poolTokenIn: BASE_WA_USDC.address,
          wrapIn: WrapAction.WRAP,
          tokenIn: BASE_USDC.address,
        },
        {
          tokenOut: BASE_USDC.address,
          wrapOut: WrapAction.UNWRAP,
          poolTokenOut: BASE_WM_USDC.address,
          deployer: ZERO_ADDRESS,
          poolTokenIn: BASE_SPARK_USDC.address,
          wrapIn: WrapAction.WRAP,
          tokenIn: BASE_USDC.address,
        },
      ])

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutWETH, maxUSDCIn, path, MSG_SENDER])

      const { commands, inputs } = planner
      await snapshotGasCost(router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
    })
  })
})
