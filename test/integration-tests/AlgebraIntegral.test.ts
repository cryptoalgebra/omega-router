import type { Contract } from '@ethersproject/contracts'
import { expect } from './shared/expect'
import { BigNumber, BigNumberish } from 'ethers'
import { IPermit2, UniversalRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import {resetFork, BASE_WETH, BASE_USDC, BASE_DAI, PERMIT2, BASE_DAI_WHALE} from './shared/mainnetForkHelpers'
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
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployUniversalRouter from './shared/deployUniversalRouter'
import { RoutePlanner, CommandType } from './shared/planner'
import hre from 'hardhat'
import { encodePathExactInputIntegral, encodePathExactOutputIntegral } from './shared/swapRouter02Helpers'
import { executeRouter, DEX } from './shared/executeRouter'
import { getPermitSignature, PermitSingle } from './shared/protocolHelpers/permit2'
const { ethers } = hre

describe('Algebra Integral Tests:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let usdcContract: Contract
  let wethContract: Contract
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

  describe('Trade on Uniswap with Permit2, giving approval every time', () => {
    let permit: PermitSingle

    beforeEach(async () => {
      // cancel the permit on DAI
      await permit2.approve(BASE_USDC.address, ZERO_ADDRESS, 0, 0)
    })

    it('V3 exactIn, permiting the exact amount', async () => {
      const amountInDAI = expandTo6DecimalsBN(100)
      const minAmountOutWETH = expandTo18DecimalsBN(0.02)

      // first bob approves permit2 to access his DAI
      await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)

      // second bob signs a permit to allow the router to access his DAI
      permit = {
        details: {
          token: BASE_USDC.address,
          amount: amountInDAI,
          expiration: 0, // expiration of 0 is block.timestamp
          nonce: 0, // this is his first trade
        },
        spender: router.address,
        sigDeadline: DEADLINE,
      }
      const sig = await getPermitSignature(permit, bob, permit2)

      const path = encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address])

      // 1) permit the router to access funds, 2) trade, which takes the funds directly from permit2
      planner.addCommand(CommandType.PERMIT2_PERMIT, [permit, sig])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        MSG_SENDER,
        amountInDAI,
        minAmountOutWETH,
        path,
        SOURCE_MSG_SENDER,
      ])
      const { wethBalanceBefore, wethBalanceAfter, daiBalanceAfter, daiBalanceBefore } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOutWETH)
      expect(daiBalanceBefore.sub(daiBalanceAfter)).to.be.eq(amountInDAI)
    })

    it('V3 exactOut, permiting the exact amount', async () => {
      const maxAmountInDAI = expandTo6DecimalsBN(4400)
      const amountOutWETH = expandTo18DecimalsBN(1)

      // first bob approves permit2 to access his DAI
      await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)

      // second bob signs a permit to allow the router to access his DAI
      permit = {
        details: {
          token: BASE_USDC.address,
          amount: maxAmountInDAI,
          expiration: 0, // expiration of 0 is block.timestamp
          nonce: 0, // this is his first trade
        },
        spender: router.address,
        sigDeadline: DEADLINE,
      }
      const sig = await getPermitSignature(permit, bob, permit2)

      const path = encodePathExactOutputIntegral([BASE_USDC.address, BASE_WETH.address])

      // 1) permit the router to access funds, 2) trade, which takes the funds directly from permit2
      planner.addCommand(CommandType.PERMIT2_PERMIT, [permit, sig])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        MSG_SENDER,
        amountOutWETH,
        maxAmountInDAI,
        path,
        SOURCE_MSG_SENDER,
      ])
      const { wethBalanceBefore, wethBalanceAfter, daiBalanceAfter, daiBalanceBefore } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.eq(amountOutWETH)
      expect(daiBalanceBefore.sub(daiBalanceAfter)).to.be.lte(maxAmountInDAI)
    })
  })

  describe('ERC20 --> ERC20', () => {
    it('completes a V3 exactIn swap', async () => {
      const amountOutMin: BigNumber = expandTo18DecimalsBN(0.1)
      addV3ExactInTrades(planner, 1, amountOutMin)

      const { wethBalanceBefore, wethBalanceAfter, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const { amount0: wethTraded } = v3SwapEventArgs!
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(amountOutMin)
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.eq(wethTraded.mul(-1))
    })

    it('completes a V3 exactIn swap with longer path', async () => {
      const token_out = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
      const tokenOutContract = new ethers.Contract(token_out, TOKEN_ABI, bob)

      const amountOutMin: number = 0.004 * 10 ** 8
      addV3ExactInTrades(
        planner,
        1,
        amountOutMin,
        {
          recipient: MSG_SENDER,
          tokens: [BASE_USDC.address, BASE_WETH.address, token_out],
          tokenSource: SOURCE_MSG_SENDER
        }
      )

      const {
        daiBalanceBefore,
        daiBalanceAfter,
        wethBalanceBefore,
        wethBalanceAfter,
      } = await executeRouter(planner, bob, router, wethContract, usdcContract, daiContract, undefined, DEX.ALGEBRA_INTEGRAL)

      expect(daiBalanceBefore.sub(amountInUSD)).to.eq(daiBalanceAfter)
      expect(wethBalanceAfter).to.eq(wethBalanceBefore)

      const tokenOutResult = await tokenOutContract.balanceOf(bob.address);

      expect(tokenOutResult).to.be.gte(amountOutMin)
    })

    it('completes a V3 exactOut swap', async () => {
      // trade DAI in for WETH out
      const tokens = [BASE_USDC.address, BASE_WETH.address]
      const path = encodePathExactOutputIntegral(tokens)

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutETH, amountInMaxUSD, path, SOURCE_MSG_SENDER])

      const { wethBalanceBefore, wethBalanceAfter, v3SwapEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const { amount0: daiTraded } = v3SwapEventArgs!
      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.eq(amountOutETH)
      expect(daiTraded).to.be.lt(amountInMaxUSD)
    })

    it('completes a V3 exactOut swap with longer path', async () => {
      // trade DAI in for WETH out
      const tokens = [BASE_DAI.address, BASE_USDC.address, BASE_WETH.address]
      const path = encodePathExactOutputIntegral(tokens)
      const amountInMax = expandTo18DecimalsBN(5000)

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutETH, amountInMax, path, SOURCE_MSG_SENDER])
      const { commands, inputs } = planner

      const balanceWethBefore = await wethContract.balanceOf(bob.address)
      await router.connect(bob)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE)
      const balanceWethAfter = await wethContract.balanceOf(bob.address)
      expect(balanceWethAfter.sub(balanceWethBefore)).to.eq(amountOutETH)
    })
  })

  describe('ERC20 --> ETH', () => {
    it('completes a V3 exactIn swap', async () => {
      const amountOutMin: BigNumber = expandTo18DecimalsBN(0.1)
      addV3ExactInTrades(planner, 1, amountOutMin, {recipient: ADDRESS_THIS})
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, 0])

      const { ethBalanceBefore, ethBalanceAfter, v3SwapEventArgs, gasSpent } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )
      const { amount0: wethTraded } = v3SwapEventArgs!

      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gte(amountOutMin.sub(gasSpent))
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.eq(wethTraded.mul(-1).sub(gasSpent))
    })

    it('completes a V3 exactOut swap', async () => {
      // trade DAI in for WETH out
      const tokens = [BASE_USDC.address, BASE_WETH.address]
      const path = encodePathExactOutputIntegral(tokens)

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [ADDRESS_THIS, amountOutETH, amountInMaxUSD, path, SOURCE_MSG_SENDER])
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, amountOutETH])

      const { ethBalanceBefore, ethBalanceAfter, gasSpent } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.eq(amountOutETH.sub(gasSpent))
    })
  })

  describe('ETH --> ERC20', () => {
    it('completes a V3 exactIn swap', async () => {
      const tokens = [BASE_WETH.address, BASE_USDC.address]
      const amountOutMin: BigNumber = expandTo6DecimalsBN(800)

      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amountInETH])
      addV3ExactInTrades(planner, 1, amountOutMin, {
        recipient: MSG_SENDER,
        tokens,
        tokenSource: SOURCE_ROUTER,
        amountIn: amountInETH
      })

      const { ethBalanceBefore, ethBalanceAfter, daiBalanceBefore, daiBalanceAfter, gasSpent } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        usdcContract,
        daiContract,
        amountInETH,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(ethBalanceBefore.sub(ethBalanceAfter)).to.eq(amountInETH.add(gasSpent))
      expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.gte(amountOutMin)
    })

    it('completes a V3 exactOut swap', async () => {
      const tokens = [BASE_WETH.address, BASE_USDC.address]
      const path = encodePathExactOutputIntegral(tokens)

      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amountInMaxETH])
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [MSG_SENDER, amountOutUSD, amountInMaxETH, path, SOURCE_ROUTER])
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, 0])

      const { ethBalanceBefore, ethBalanceAfter, daiBalanceBefore, daiBalanceAfter, gasSpent, v3SwapEventArgs } =
        await executeRouter(planner, bob, router, wethContract, usdcContract, daiContract, amountInMaxETH, DEX.ALGEBRA_INTEGRAL)
      // amount1 is dai because DAI.address > WETH.address
      const { amount1: daiTraded, amount0: wethTraded } = v3SwapEventArgs!

      expect(daiBalanceBefore.sub(daiBalanceAfter)).to.eq(daiTraded)
      expect(ethBalanceBefore.sub(ethBalanceAfter)).to.eq(wethTraded.add(gasSpent))
    })
  })
})
