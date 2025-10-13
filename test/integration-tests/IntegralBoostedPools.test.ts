import type { Contract } from '@ethersproject/contracts'
import { expect } from './shared/expect'
import { BigNumber } from 'ethers'
import { IPermit2, UniversalRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import {
  BASE_DAI,
  BASE_DAI_WHALE,
  BASE_USDC,
  BASE_WA_WETH,
  BASE_WETH,
  BASE_WM_USDC,
  INTEGRAL_NFT_POSITION_MANAGER,
  PERMIT2,
  resetFork,
} from './shared/mainnetForkHelpers'
import {
  ADDRESS_THIS,
  BASE_ALICE_ADDRESS,
  CONTRACT_BALANCE,
  DEADLINE,
  MAX_UINT,
  MAX_UINT128,
  MAX_UINT160,
  MSG_SENDER,
  SOURCE_ROUTER,
  ZERO_ADDRESS,
} from './shared/constants'
import { expand6To18DecimalsBN, expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployUniversalRouter from './shared/deployUniversalRouter'
import { CommandType, RoutePlanner } from './shared/planner'
import hre from 'hardhat'
import { encodePathExactInputIntegral } from './shared/swapRouter02Helpers'
import { DEX, executeRouter, ExecutionParams } from './shared/executeRouter'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { encodePriceSqrt } from '../../lib/v3-periphery/test/shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../../lib/v3-periphery/test/shared/ticks'
import {encodeCollect, encodeDecreaseLiquidity, encodeERC721Permit} from './shared/encodeCall'
import getPermitNFTSignature from './shared/getPermitNFTSignature'

const { ethers } = hre

describe('Algebra Integral Boosted Pools Tests:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let vault: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let usdcContract: Contract
  let wethContract: Contract
  let wWETHContract: Contract
  let wUSDCContract: Contract
  let daiContract: Contract
  let planner: RoutePlanner

  async function swapUSDCtoWETH(): Promise<ExecutionParams> {
    const v3Tokens = [BASE_WM_USDC.address, BASE_WA_WETH.address]

    const amountInUSDC = expandTo6DecimalsBN(100)
    const expectedAmountOutWaUSDC = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))
      .mul(99)
      .div(100)

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

    return await executeRouter(
      planner,
      bob,
      router,
      wethContract,
      daiContract,
      usdcContract,
      undefined,
      DEX.ALGEBRA_INTEGRAL
    )
  }

  async function swapWETHtoUSDC(): Promise<ExecutionParams> {
    const v3Tokens = [BASE_WA_WETH.address, BASE_WM_USDC.address]

    const amountInWeth = expandTo18DecimalsBN(0.02)
    const expectedAmountOutWWeth = BigNumber.from(await wWETHContract.previewDeposit(amountInWeth))
      .mul(99)
      .div(100)

    // 1) transferFrom the funds,
    // 2) perform wrap
    // 3) Uniswap V3 swap using router's balance; amountIn = router's balance
    // 4) perform unwrap; amountIn = router's balance
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

    return await executeRouter(
      planner,
      bob,
      router,
      wethContract,
      daiContract,
      usdcContract,
      undefined,
      DEX.ALGEBRA_INTEGRAL
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
    vault = (await ethers.getSigners())[2]
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
  })

  describe('Swaps', () => {
    beforeEach('provide liquidity to Boosted Pool', async () => {
      // Get wrapped tokens for the LP
      await wethContract.connect(alice).approve(BASE_WA_WETH.address, MAX_UINT)
      await usdcContract.connect(alice).approve(BASE_WM_USDC.address, MAX_UINT)

      await wWETHContract.connect(alice).deposit(expandTo18DecimalsBN(21.4), alice.address)
      await wUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(90000), alice.address)

      const wWETHAmount = await wWETHContract.balanceOf(alice.address)
      const wUSDCAmount = await wUSDCContract.balanceOf(alice.address)
      // create V3 pool with ERC4626 tokens
      await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
        wUSDCContract.address,
        wWETHContract.address,
        ADDRESS_ZERO,
        encodePriceSqrt(wWETHAmount, wUSDCAmount),
        '0x'
      )

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
        deadline: 10000000000000,
      })
    })

    it('100 USDC wrap -> wmUSDC swap -> waWETH unwrap -> WETH', async () => {
      const { ethBalanceBefore, ethBalanceAfter, v3SwapEventArgs, gasSpent } = await swapUSDCtoWETH()

      const amountOut = (v3SwapEventArgs?.amount1!).mul(-1)

      // "greater than" because `amountOut` is WA_ETH amount. After UNWRAP it transforms into the greater ETH amount
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gt(amountOut.sub(gasSpent))
    })

    it('0.02 WETH wrap -> waWETH swap -> wUSDC unwrap -> USDC', async () => {
      const { usdcBalanceBefore, usdcBalanceAfter, v3SwapEventArgs } = await swapWETHtoUSDC()

      const amountOut = v3SwapEventArgs?.amount0!.mul(-1)

      // "greater than" because `amountOut` is WA_ETH amount. After UNWRAP it transforms into the greater ETH amount
      expect(expand6To18DecimalsBN(usdcBalanceAfter.sub(usdcBalanceBefore))).to.be.gt(amountOut)
    })
  })

  describe('Positions', () => {
    let tokenId: BigNumber

    function collect(recipient: string): string {
      // set receiver to v4posm
      const collectParams = {
        tokenId: tokenId,
        recipient: recipient,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      }

      return encodeCollect(collectParams)
    }

    async function permit(): Promise<string> {
      const { v, r, s } = await getPermitNFTSignature(
        bob,
        INTEGRAL_NFT_POSITION_MANAGER.connect(bob),
        router.address,
        tokenId,
        MAX_UINT
      )
      const erc721PermitParams = {
        spender: router.address,
        tokenId: tokenId,
        deadline: MAX_UINT,
        v: v,
        r: r,
        s: s,
      }

      return encodeERC721Permit(erc721PermitParams)
    }

    async function decreaseLiquidity(): Promise<string> {
      let position = await INTEGRAL_NFT_POSITION_MANAGER.connect(bob).positions(tokenId)
      let liquidity = position.liquidity

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: MAX_UINT,
      }

      return encodeDecreaseLiquidity(decreaseParams)
    }

    beforeEach('provide liquidity', async () => {
      const ethToWeth = BigNumber.from(await wWETHContract.previewDeposit(expandTo18DecimalsBN(1)))
      const usdcToWusdc = BigNumber.from(await wUSDCContract.previewDeposit(expandTo6DecimalsBN(4200)))

      await INTEGRAL_NFT_POSITION_MANAGER.connect(bob).createAndInitializePoolIfNecessary(
        wUSDCContract.address,
        wWETHContract.address,
        ADDRESS_ZERO,
        encodePriceSqrt(ethToWeth, usdcToWusdc),
        '0x'
      )

      const amountInUSDC = expandTo6DecimalsBN(4200)
      const amountInWETH = expandTo18DecimalsBN(1)

      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_WETH.address, router.address, amountInWETH])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        wUSDCContract.address,
        usdcContract.address,
        ADDRESS_THIS,
        amountInUSDC,
        usdcToWusdc.mul(99).div(100),
      ])
      planner.addCommand(CommandType.ERC4626_WRAP, [
        wWETHContract.address,
        wethContract.address,
        ADDRESS_THIS,
        amountInWETH,
        ethToWeth.mul(99).div(100),
      ])
      planner.addCommand(CommandType.INTEGRAL_MINT, [
        [
          BASE_WM_USDC.address,
          BASE_WA_WETH.address,
          ZERO_ADDRESS,
          getMinTick(60),
          getMaxTick(60),
          CONTRACT_BALANCE,
          CONTRACT_BALANCE,
          0,
          0,
          MSG_SENDER,
          DEADLINE,
        ],
      ])

      const { integralPosEventArgs } = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      // reset planner after swaps
      planner = new RoutePlanner()

      tokenId = integralPosEventArgs![0].tokenId
    })

    it('collect fees with unwrap', async () => {
      await swapUSDCtoWETH()
      await swapWETHtoUSDC()

      // reset planner after swaps
      planner = new RoutePlanner()

      const encodedErc721PermitCall = await permit()
      const encodedCollectCall = collect(router.address)

      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedErc721PermitCall])
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedCollectCall])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wWETHContract.address, vault.address, CONTRACT_BALANCE, 0])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wUSDCContract.address, vault.address, CONTRACT_BALANCE, 0])

      await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(await usdcContract.balanceOf(vault.address)).to.be.gt(0)
      expect(await wethContract.balanceOf(vault.address)).to.be.gt(0)
    })

    it('remove liquidity with unwrap', async () => {
      const encodedErc721PermitCall = await permit()
      const encodedDecreaseCall = decreaseLiquidity()
      const encodedCollectCall = collect(router.address)

      console.log(await wWETHContract.balanceOf(router.address))
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedErc721PermitCall])
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedDecreaseCall])
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedCollectCall])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wWETHContract.address, vault.address, CONTRACT_BALANCE, 0])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wUSDCContract.address, vault.address, CONTRACT_BALANCE, 0])

      const {integralPosEventArgs} = await executeRouter(
        planner,
        bob,
        router,
        wethContract,
        daiContract,
        usdcContract,
        undefined,
        DEX.ALGEBRA_INTEGRAL
      )

      console.log(integralPosEventArgs)

      expect(await usdcContract.balanceOf(vault.address)).to.be.approximately(expandTo6DecimalsBN(4200), 10)
      expect(await wethContract.balanceOf(vault.address)).to.be.approximately(expandTo18DecimalsBN(1), 10)
    })
  })
})
