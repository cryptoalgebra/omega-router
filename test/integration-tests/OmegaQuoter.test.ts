import { expect } from './shared/expect'
import { OmegaQuoter } from '../../typechain'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { Contract } from '@ethersproject/contracts'
import {
  resetFork,
  MAINNET_WETH,
  MAINNET_DAI,
  MAINNET_USDC,
  MAINNET_WA_USDC,
  BASE_WETH,
  BASE_USDC,
  BASE_DAI,
  BASE_WM_USDC,
  BASE_WA_WETH,
  BASE_USDC_WHALE,
  INTEGRAL_NFT_POSITION_MANAGER,
  BASE_WETH_WHALE,
} from './shared/mainnetForkHelpers'
import {
  CONTRACT_BALANCE,
  PERMIT2_ADDRESS,
  UNISWAP_V2_FACTORY_MAINNET,
  UNISWAP_V3_FACTORY_MAINNET,
  UNISWAP_V2_INIT_CODE_HASH_MAINNET,
  UNISWAP_V3_INIT_CODE_HASH_MAINNET,
  INTEGRAL_FACTORY_MAINNET,
  INTEGRAL_POOL_DEPLOYER,
  INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
  INTEGRAL_INIT_CODE_HASH_MAINNET,
  BASE_ALICE_ADDRESS,
  MAX_UINT,
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { QuoterPlanner, QuoterResultParser } from './shared/quoterPlanner'
import hre from 'hardhat'
import {
  encodePathExactInput,
  encodePathExactOutput,
  encodePathExactInputIntegral,
  encodeSingleBoostedPoolExactOutput,
  WrapAction,
} from './shared/swapRouter02Helpers'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { encodePriceSqrt } from '../../lib/v3-periphery/test/shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../../lib/v3-periphery/test/shared/ticks'
const { ethers } = hre

describe('OmegaQuoter Tests:', () => {
  let bob: SignerWithAddress
  let quoter: OmegaQuoter

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

  describe('Mainnet Fork - V2 and V3 Quoter', () => {
    beforeEach(async () => {
      await resetFork()
      bob = (await ethers.getSigners())[1]
      quoter = await deployQuoter(MAINNET_WETH.address)
    })

    describe('V2 Quoter', () => {
      it('quotes exactIn swap: DAI -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut } = QuoterResultParser.parseV2SwapResult(outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      })

      it('quotes exactOut swap: DAI -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(1)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactOut(amountOut, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountIn } = QuoterResultParser.parseV2ExactOutResult(outputs[0])
        expect(amountIn).to.be.gt(expandTo18DecimalsBN(3000))
        expect(amountIn).to.be.lt(expandTo18DecimalsBN(6000))
      })

      it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut } = QuoterResultParser.parseV2SwapResult(outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      })

      it('quotes multihop exactOut: DAI -> USDC -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(1)
        const path = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactOut(amountOut, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountIn } = QuoterResultParser.parseV2ExactOutResult(outputs[0])
        expect(amountIn).to.be.gt(expandTo18DecimalsBN(3000))
        expect(amountIn).to.be.lt(expandTo18DecimalsBN(6000))
      })
    })

    describe('V3 Quoter', () => {
      it('quotes exactIn swap: DAI -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseV3SwapResult(outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
        expect(sqrtPriceX96AfterList.length).to.equal(1)
        expect(gasEstimate).to.be.gt(0)
      })

      it('quotes exactOut swap: DAI -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(1)
        const path = encodePathExactOutput([MAINNET_DAI.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactOut(amountOut, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountIn, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseV3ExactOutResult(outputs[0])
        expect(amountIn).to.be.gt(expandTo18DecimalsBN(3000))
        expect(amountIn).to.be.lt(expandTo18DecimalsBN(6000))
        expect(sqrtPriceX96AfterList.length).to.equal(1)
        expect(gasEstimate).to.be.gt(0)
      })

      it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseV3SwapResult(outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
        expect(sqrtPriceX96AfterList.length).to.equal(2) 
        expect(gasEstimate).to.be.gt(0)
      })
    })

    describe('ERC4626 Quoter', () => {
      beforeEach(async () => {
        await resetFork(23377219)
        bob = (await ethers.getSigners())[1]
        quoter = await deployQuoter(MAINNET_WETH.address)
      })

      it('quotes wrap: USDC -> waUSDC', async () => {
        const waUsdcContract = new ethers.Contract(MAINNET_WA_USDC.address, ERC4626_ABI, bob)
        const amountIn = expandTo6DecimalsBN(100)

        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, amountIn)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut } = QuoterResultParser.parseERC4626Result(outputs[0])
        const expectedAmountOut = await waUsdcContract.previewDeposit(amountIn)
        expect(amountOut).to.equal(expectedAmountOut)
      })

      it('quotes unwrap: waUSDC -> USDC', async () => {
        const waUsdcContract = new ethers.Contract(MAINNET_WA_USDC.address, ERC4626_ABI, bob)
        const amountIn = expandTo6DecimalsBN(100)

        const planner = new QuoterPlanner()
        planner.addERC4626Unwrap(MAINNET_WA_USDC.address, amountIn)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut } = QuoterResultParser.parseERC4626Result(outputs[0])
        const expectedAmountOut = await waUsdcContract.previewRedeem(amountIn)
        expect(amountOut).to.equal(expectedAmountOut)
      })
    })

    describe('Using CONTRACT_BALANCE for chaining', () => {
      it('quotes V3 swap -> V2 swap using CONTRACT_BALANCE', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // First swap: DAI -> WETH on V3
        const pathV3 = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])
        // Second swap: WETH -> USDC on V2, using output from first swap
        const pathV2 = [MAINNET_WETH.address, MAINNET_USDC.address]

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, pathV3)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const { amountOut: amountOutV3 } = QuoterResultParser.parseV3SwapResult(outputs[0])
        expect(amountOutV3).to.be.gt(expandTo18DecimalsBN(0.02))

        const { amountOut: amountOutV2 } = QuoterResultParser.parseV2SwapResult(outputs[1])
        expect(amountOutV2).to.be.gt(expandTo6DecimalsBN(80))
      })

      it('quotes V2 swap -> V3 swap using CONTRACT_BALANCE', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // First swap: DAI -> USDC on V2
        const pathV2 = [MAINNET_DAI.address, MAINNET_USDC.address]
        // Second swap: USDC -> WETH on V3, using output from first swap
        const pathV3 = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2)
        planner.addV3SwapExactIn(CONTRACT_BALANCE, pathV3)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const { amountOut: amountOutV2 } = QuoterResultParser.parseV2SwapResult(outputs[0])
        expect(amountOutV2).to.be.gt(expandTo6DecimalsBN(95))

        const { amountOut: amountOutV3 } = QuoterResultParser.parseV3SwapResult(outputs[1])
        expect(amountOutV3).to.be.gt(expandTo18DecimalsBN(0.02))
      })

      it('quotes V2 swap -> V2 swap using CONTRACT_BALANCE', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // First swap: DAI -> USDC on V2
        const pathV2_1 = [MAINNET_DAI.address, MAINNET_USDC.address]
        // Second swap: USDC -> WETH on V2, using output from first swap
        const pathV2_2 = [MAINNET_USDC.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2_1)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2_2)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const { amountOut: amountOutV2_1 } = QuoterResultParser.parseV2SwapResult(outputs[0])
        expect(amountOutV2_1).to.be.gt(expandTo6DecimalsBN(95))

        const { amountOut: amountOutV2_2 } = QuoterResultParser.parseV2SwapResult(outputs[1])
        expect(amountOutV2_2).to.be.gt(expandTo18DecimalsBN(0.02))
      })

      it('quotes V3 swap -> V3 swap using CONTRACT_BALANCE', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // First swap: DAI -> USDC on V3
        const pathV3_1 = encodePathExactInput([MAINNET_DAI.address, MAINNET_USDC.address])
        // Second swap: USDC -> WETH on V3, using output from first swap
        const pathV3_2 = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, pathV3_1)
        planner.addV3SwapExactIn(CONTRACT_BALANCE, pathV3_2)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const { amountOut: amountOutV3_1 } = QuoterResultParser.parseV3SwapResult(outputs[0])
        expect(amountOutV3_1).to.be.gt(expandTo6DecimalsBN(95))

        const { amountOut: amountOutV3_2 } = QuoterResultParser.parseV3SwapResult(outputs[1])
        expect(amountOutV3_2).to.be.gt(expandTo18DecimalsBN(0.02))
      })
    })
  })

  describe('Base Fork - Algebra Integral Quoter', () => {
    beforeEach(async () => {
      await resetFork(36274285, `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`)
      bob = (await ethers.getSigners())[1]
      quoter = await deployQuoter(BASE_WETH.address)
    })

    it('quotes exactIn swap: USDC -> WETH', async () => {
      const amountIn = expandTo6DecimalsBN(100)
      const path = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])

      const planner = new QuoterPlanner()
      planner.addIntegralSwapExactIn(amountIn, path)
      const { commands, inputs } = planner.finalize()

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const { amountOut, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseIntegralSwapResult(outputs[0])
      expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      expect(sqrtPriceX96AfterList.length).to.equal(1)
      expect(gasEstimate).to.be.gt(0)
    })

    it('quotes exactOut swap: USDC -> WETH', async () => {
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

      const planner = new QuoterPlanner()
      planner.addIntegralSwapExactOut(amountOut, path)
      const { commands, inputs } = planner.finalize()

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const { amountIn, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseV3ExactOutResult(outputs[0])
      expect(amountIn).to.be.gt(expandTo6DecimalsBN(30))
      expect(amountIn).to.be.lt(expandTo6DecimalsBN(60))
      expect(sqrtPriceX96AfterList.length).to.equal(1)
      expect(gasEstimate).to.be.gt(0)
    })

    it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInputIntegral([BASE_DAI.address, BASE_USDC.address, BASE_WETH.address])

      const planner = new QuoterPlanner()
      planner.addIntegralSwapExactIn(amountIn, path)
      const { commands, inputs } = planner.finalize()

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const { amountOut, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseIntegralSwapResult(outputs[0])
      expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      expect(sqrtPriceX96AfterList.length).to.equal(2) // 2 pools
      expect(gasEstimate).to.be.gt(0)
    })

    it('chains Integral swap -> Integral swap using CONTRACT_BALANCE', async () => {
      const amountIn = expandTo18DecimalsBN(100)

      // First: swap DAI -> USDC on Integral
      // Second: swap USDC -> WETH on Integral, using output from first swap
      const pathFirst = encodePathExactInputIntegral([BASE_DAI.address, BASE_USDC.address])
      const pathSecond = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])

      const planner = new QuoterPlanner()
      planner.addIntegralSwapExactIn(amountIn, pathFirst)
      planner.addIntegralSwapExactIn(CONTRACT_BALANCE, pathSecond)
      const { commands, inputs } = planner.finalize()

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(2)

      const { amountOut: amountOutFirst } = QuoterResultParser.parseIntegralSwapResult(outputs[0])
      expect(amountOutFirst).to.be.gt(expandTo6DecimalsBN(95))

      const { amountOut: amountOutSecond } = QuoterResultParser.parseIntegralSwapResult(outputs[1])
      expect(amountOutSecond).to.be.gt(expandTo18DecimalsBN(0.02))
    })

    describe('Boosted Pools with ERC4626', () => {
      let alice: SignerWithAddress
      let usdcContract: Contract
      let wethContract: Contract
      let wWETHContract: Contract
      let wUSDCContract: Contract

      beforeEach('create boosted pool', async () => {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [BASE_ALICE_ADDRESS],
        })
        alice = await ethers.getSigner(BASE_ALICE_ADDRESS)

        usdcContract = new ethers.Contract(BASE_USDC.address, TOKEN_ABI, alice)
        wethContract = new ethers.Contract(BASE_WETH.address, TOKEN_ABI, alice)
        wWETHContract = new ethers.Contract(BASE_WA_WETH.address, ERC4626_ABI, alice)
        wUSDCContract = new ethers.Contract(BASE_WM_USDC.address, ERC4626_ABI, alice)

        await wethContract.approve(BASE_WA_WETH.address, MAX_UINT)
        await usdcContract.approve(BASE_WM_USDC.address, MAX_UINT)

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [BASE_USDC_WHALE],
        })
        const usdcWhale = await ethers.getSigner(BASE_USDC_WHALE)
        await usdcContract.connect(usdcWhale).transfer(alice.address, expandTo6DecimalsBN(1000000))

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [BASE_WETH_WHALE],
        })
        const wethWhale = await ethers.getSigner(BASE_WETH_WHALE)
        await wethContract.connect(wethWhale).transfer(alice.address, expandTo18DecimalsBN(30))

        await wWETHContract.deposit(expandTo18DecimalsBN(21.4), alice.address)
        await wUSDCContract.deposit(expandTo6DecimalsBN(90000), alice.address)

        const wWETHAmount = await wWETHContract.balanceOf(alice.address)
        const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)

        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
          wUSDCContract.address,
          wWETHContract.address,
          ADDRESS_ZERO,
          encodePriceSqrt(wWETHAmount, wUSDCAmount),
          '0x'
        )

        await wWETHContract.approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
        await wUSDCContract.approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

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

      it('quotes exactOut with boosted path: USDC -> wUSDC -> wWETH -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(0.01)
        const path = encodeSingleBoostedPoolExactOutput(
          BASE_WETH.address,
          WrapAction.UNWRAP,
          BASE_WA_WETH.address,
          ADDRESS_ZERO,
          BASE_WM_USDC.address,
          WrapAction.WRAP,
          BASE_USDC.address
        )

        const planner = new QuoterPlanner()
        planner.addIntegralSwapExactOut(amountOut, path)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountIn, sqrtPriceX96AfterList, gasEstimate } = QuoterResultParser.parseV3ExactOutResult(outputs[0])
        expect(amountIn).to.be.gt(expandTo6DecimalsBN(30))
        expect(amountIn).to.be.lt(expandTo6DecimalsBN(60))
        expect(sqrtPriceX96AfterList.length).to.equal(1)
        expect(gasEstimate).to.be.gt(0)
      })
    })

    describe('Edge Cases - V2 Quoter', () => {
      it('quotes with very small amount: 1 wei DAI -> WETH (should revert)', async () => {
        const amountIn = ethers.BigNumber.from(1)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('reverts on quote with invalid path (empty)', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path: string[] = []

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('reverts on quote with single token path', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = [MAINNET_DAI.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('quotes precision after multiple hops maintains consistency (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = [
          MAINNET_DAI.address,
          MAINNET_USDC.address,
          MAINNET_WETH.address,
        ]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })

    describe('Edge Cases - V3 Quoter', () => {
      it('quotes with very small amount: 1 wei DAI -> WETH (should revert)', async () => {
        const amountIn = ethers.BigNumber.from(1)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('quotes with very large amount (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(10000)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('quotes precision after multiple hops maintains consistency (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([
          MAINNET_DAI.address,
          MAINNET_USDC.address,
          MAINNET_WETH.address,
        ])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('reverts on quote with invalid path (empty)', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        // Empty path - pass empty bytes directly instead of encoding
        const emptyPath = '0x'

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, emptyPath)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('reverts on quote with single token path', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([MAINNET_DAI.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })

    describe('Error Handling', () => {
      it('handles non-existent pool gracefully', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        // Create path with tokens that likely don't have a V3 pool
        const path = encodePathExactInput([
          '0x0000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000002',
        ])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(amountIn, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('handles mixed valid and invalid paths', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        // Valid path
        const pathV2 = [MAINNET_DAI.address, MAINNET_WETH.address]
        // Invalid path with fake tokens
        const pathV3 = encodePathExactInput([
          '0x0000000000000000000000000000000000000001',
          MAINNET_WETH.address,
        ])

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2)
        planner.addV3SwapExactIn(expandTo18DecimalsBN(1), pathV3)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })

    describe('CONTRACT_BALANCE Chaining - Advanced', () => {
      it('chains 3 swaps: V2 -> V3 -> V2 using CONTRACT_BALANCE (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(50)

        const pathV2_1 = [MAINNET_DAI.address, MAINNET_USDC.address]
        const pathV3 = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])
        const pathV2_2 = [MAINNET_WETH.address, MAINNET_DAI.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2_1)
        planner.addV3SwapExactIn(CONTRACT_BALANCE, pathV3)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2_2)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('chain degrades gracefully when middle swap fails', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        const pathV2 = [MAINNET_DAI.address, MAINNET_USDC.address]
        // Invalid path that will fail
        const pathV3Invalid = encodePathExactInput([
          '0x0000000000000000000000000000000000000001',
          MAINNET_WETH.address,
        ])
        const pathV2_2 = [MAINNET_WETH.address, MAINNET_DAI.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2)
        planner.addV3SwapExactIn(CONTRACT_BALANCE, pathV3Invalid)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2_2)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })

    describe('ERC4626 Edge Cases', () => {
      beforeEach(async () => {
        await resetFork(23377219)
        bob = (await ethers.getSigners())[1]
        quoter = await deployQuoter(MAINNET_WETH.address)
      })

      it('quotes wrap with very small amount', async () => {
        const amountIn = ethers.BigNumber.from(1)

        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, amountIn)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut } = QuoterResultParser.parseERC4626Result(outputs[0])
        expect(amountOut).to.be.gte(0)
      })

      it('chain wrap -> swap -> unwrap maintains precision', async () => {
        const amountIn = expandTo6DecimalsBN(100)

        // Wrap USDC to waUSDC
        // Swap waUSDC
        // Unwrap back

        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, amountIn)
        const { commands, inputs } = planner.finalize()

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const { amountOut: wrappedAmount } = QuoterResultParser.parseERC4626Result(outputs[0])
        expect(wrappedAmount).to.be.gt(0)
      })
    })

    describe('ERC4626 Wrap-Unwrap ExactOut Combinations', () => {
      beforeEach(async () => {
        await resetFork(23377219)
        bob = (await ethers.getSigners())[1]
        quoter = await deployQuoter(MAINNET_WETH.address)
      })

      it('wrap -> V2 exactOut -> unwrap', async () => {
        const amountOut = expandTo6DecimalsBN(50)
        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        planner.addV2SwapExactOut(amountOut, [MAINNET_WA_USDC.address, MAINNET_USDC.address])
        planner.addERC4626Unwrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        const { commands, inputs } = planner.finalize()
        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('wrap -> V3 exactOut -> unwrap', async () => {
        const amountOut = expandTo6DecimalsBN(50)
        const path = encodePathExactOutput([
          MAINNET_WA_USDC.address,
          MAINNET_USDC.address
        ])
        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        planner.addV3SwapExactOut(amountOut, path)
        planner.addERC4626Unwrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        const { commands, inputs } = planner.finalize()
        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('wrap -> V2 exactOut -> V3 exactOut -> unwrap', async () => {
        const amountOut = expandTo6DecimalsBN(40)
        const pathV2 = [MAINNET_WA_USDC.address, MAINNET_USDC.address]
        const pathV3 = encodePathExactOutput([
          MAINNET_USDC.address,
          MAINNET_DAI.address
        ])
        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        planner.addV2SwapExactOut(expandTo6DecimalsBN(50), pathV2)
        planner.addV3SwapExactOut(amountOut, pathV3)
        planner.addERC4626Unwrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        const { commands, inputs } = planner.finalize()
        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('wrap -> V3 exactOut -> V2 exactOut -> unwrap', async () => {
        const amountOut = expandTo6DecimalsBN(50)
        const pathV3 = encodePathExactOutput([
          MAINNET_WA_USDC.address,
          MAINNET_DAI.address
        ])
        const pathV2 = [MAINNET_DAI.address, MAINNET_USDC.address]
        const planner = new QuoterPlanner()
        planner.addERC4626Wrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        planner.addV3SwapExactOut(expandTo6DecimalsBN(50), pathV3)
        planner.addV2SwapExactOut(amountOut, pathV2)
        planner.addERC4626Unwrap(MAINNET_WA_USDC.address, CONTRACT_BALANCE)
        const { commands, inputs } = planner.finalize()
        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })

    describe('Gas Optimization Tests', () => {
      it('gas cost increases with number of hops on V2 (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // 1 hop
        const path1 = [MAINNET_DAI.address, MAINNET_WETH.address]
        const planner1 = new QuoterPlanner()
        planner1.addV2SwapExactIn(amountIn, path1)
        const { commands: cmd1, inputs: inp1 } = planner1.finalize()
        await expect(quoter.callStatic.execute(cmd1, inp1)).to.be.reverted

        // 2 hops
        const path2 = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]
        const planner2 = new QuoterPlanner()
        planner2.addV2SwapExactIn(amountIn, path2)
        const { commands: cmd2, inputs: inp2 } = planner2.finalize()
        await expect(quoter.callStatic.execute(cmd2, inp2)).to.be.reverted
      })

      it('compares gas estimate: V3 multihop vs single hop (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // Single hop V3
        const pathSingle = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])
        const plannerSingle = new QuoterPlanner()
        plannerSingle.addV3SwapExactIn(amountIn, pathSingle)
        const { commands: cmdSingle, inputs: inpSingle } = plannerSingle.finalize()
        await expect(quoter.callStatic.execute(cmdSingle, inpSingle)).to.be.reverted

        // Multihop V3
        const pathMulti = encodePathExactInput([
          MAINNET_DAI.address,
          MAINNET_USDC.address,
          MAINNET_WETH.address,
        ])
        const plannerMulti = new QuoterPlanner()
        plannerMulti.addV3SwapExactIn(amountIn, pathMulti)
        const { commands: cmdMulti, inputs: inpMulti } = plannerMulti.finalize()
        await expect(quoter.callStatic.execute(cmdMulti, inpMulti)).to.be.reverted
      })
    })

    describe('Stress Tests', () => {
      it('handles quote with very large amount: V2 (should revert)', async () => {
        const largeAmount = expandTo18DecimalsBN(10000)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(largeAmount, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('handles quote with very large amount: V3 (should revert)', async () => {
        const largeAmount = expandTo18DecimalsBN(10000)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

        const planner = new QuoterPlanner()
        planner.addV3SwapExactIn(largeAmount, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('handles quote with maximum safe input amount: V2 (should revert)', async () => {
        const maxAmount = expandTo18DecimalsBN(1000000)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(maxAmount, path)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })

      it('processes 4-hop chain successfully (should revert)', async () => {
        const amountIn = expandTo18DecimalsBN(50)

        const pathV2_1 = [MAINNET_DAI.address, MAINNET_USDC.address]
        const pathV3_1 = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])
        const pathV2_2 = [MAINNET_WETH.address, MAINNET_DAI.address]
        const pathV2_3 = [MAINNET_DAI.address, MAINNET_USDC.address]

        const planner = new QuoterPlanner()
        planner.addV2SwapExactIn(amountIn, pathV2_1)
        planner.addV3SwapExactIn(CONTRACT_BALANCE, pathV3_1)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2_2)
        planner.addV2SwapExactIn(CONTRACT_BALANCE, pathV2_3)
        const { commands, inputs } = planner.finalize()

        await expect(quoter.callStatic.execute(commands, inputs)).to.be.reverted
      })
    })
  })
})
