import type { Contract } from '@ethersproject/contracts'
import { expect } from './shared/expect'
import { BigNumber } from 'ethers'
import { IPermit2, OmegaRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import {
  BASE_DAI,
  BASE_DAI_WHALE,
  BASE_USDC,
  BASE_USDC_WHALE,
  BASE_WA_WETH,
  BASE_WETH,
  BASE_WETH_WHALE,
  BASE_WM_USDC,
  BASE_MORPHO_USDC_VAULT,
  BASE_MORPHO_WETH_VAULT,
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
import deployOmegaRouter from './shared/deployOmegaRouter'
import { CommandType, RoutePlanner } from './shared/planner'
import hre from 'hardhat'
import { encodePathExactInputIntegral, encodePathExactOutputIntegral } from './shared/swapRouter02Helpers'
import { DEX, executeRouter, ExecutionParams } from './shared/executeRouter'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { encodePriceSqrt } from '../../lib/v3-periphery/test/shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../../lib/v3-periphery/test/shared/ticks'
import { encodeCollect, encodeDecreaseLiquidity, encodeERC721Permit } from './shared/encodeCall'
import getPermitNFTSignature from './shared/getPermitNFTSignature'

const { ethers } = hre

describe('Algebra Integral Boosted Pools Tests:', () => {
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let vault: SignerWithAddress
  let router: OmegaRouter
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
    await resetFork(37181420, `https://base.gateway.tenderly.co/5fIWq2TtSwjHVsZeOTK5P5`)
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
    router = (await deployOmegaRouter(BASE_WETH.address)) as OmegaRouter
    planner = new RoutePlanner()

    // Set balance for whales (give them ETH for gas)
    await hre.network.provider.send('hardhat_setBalance', [
      BASE_USDC_WHALE,
      '0x56BC75E2D63100000', // 100 ETH in hex
    ])
    await hre.network.provider.send('hardhat_setBalance', [
      BASE_WETH_WHALE,
      '0x56BC75E2D63100000', // 100 ETH in hex
    ])
    await hre.network.provider.send('hardhat_setBalance', [
      BASE_DAI_WHALE,
      '0x56BC75E2D63100000', // 100 ETH in hex
    ])

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_USDC_WHALE],
    })
    const usdcWhale = await ethers.getSigner(BASE_USDC_WHALE)

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [BASE_DAI_WHALE],
    })
    const daiWhale = await ethers.getSigner(BASE_DAI_WHALE)
    // alice gives bob some tokens
    await usdcContract.connect(usdcWhale).transfer(bob.address, expandTo6DecimalsBN(100000))
    await wethContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100))

    await daiContract.connect(daiWhale).transfer(bob.address, expandTo18DecimalsBN(100000))

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

    it('mint position with wrap', async () => {
      expect(tokenId).to.be.gt(0)

      const position = await INTEGRAL_NFT_POSITION_MANAGER.connect(bob).positions(tokenId)
      expect(position.liquidity).to.be.gt(0)
      expect(position.token0).to.equal(BASE_WM_USDC.address)
      expect(position.token1).to.equal(BASE_WA_WETH.address)

      planner = new RoutePlanner()
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wWETHContract.address, bob.address, CONTRACT_BALANCE, 0])
      planner.addCommand(CommandType.ERC4626_UNWRAP, [wUSDCContract.address, bob.address, CONTRACT_BALANCE, 0])
      
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

      expect(await wUSDCContract.balanceOf(router.address)).to.equal(0)
      expect(await wWETHContract.balanceOf(router.address)).to.equal(0)
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

      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedErc721PermitCall])
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedDecreaseCall])
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

      expect(await usdcContract.balanceOf(vault.address)).to.be.approximately(expandTo6DecimalsBN(4200), 10)
      expect(await wethContract.balanceOf(vault.address)).to.be.approximately(expandTo18DecimalsBN(1), 10**10)
    })

    it('increase liquidity with wrap', async () => {
      const amountInUSDC = expandTo6DecimalsBN(100)
      const amountInWETH = expandTo18DecimalsBN(0.02)

      const ethToWeth = BigNumber.from(await wWETHContract.previewDeposit(amountInWETH))
      const usdcToWusdc = BigNumber.from(await wUSDCContract.previewDeposit(amountInUSDC))

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
      planner.addCommand(CommandType.INTEGRAL_INCREASE_LIQUIDITY, [
        [tokenId, CONTRACT_BALANCE, CONTRACT_BALANCE, 0, 0, DEADLINE],
      ])

      const positionBefore = await INTEGRAL_NFT_POSITION_MANAGER.connect(bob).positions(tokenId)

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

      const positionAfter = await INTEGRAL_NFT_POSITION_MANAGER.connect(bob).positions(tokenId)

      expect(positionAfter.liquidity).to.be.gt(positionBefore.liquidity)
    })
  })

  describe('Morpho Vaults', () => {
    let morphoUSDCContract: Contract
    let morphoWETHContract: Contract
    let usdcWhale: SignerWithAddress
    let wethWhale: SignerWithAddress

    beforeEach(async () => {
      // Reset fork to Base with Tenderly RPC
      await resetFork(37354071, 'https://base.gateway.tenderly.co/5fIWq2TtSwjHVsZeOTK5P5')
      // Re-initialize accounts and contracts
      bob = (await ethers.getSigners())[1]
      vault = (await ethers.getSigners())[2]
      
      // Impersonate whales
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [BASE_USDC_WHALE],
      })
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [BASE_WETH_WHALE],
      })
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [BASE_DAI_WHALE],
      })

      usdcWhale = await ethers.getSigner(BASE_USDC_WHALE)
      wethWhale = await ethers.getSigner(BASE_WETH_WHALE)
      alice = await ethers.getSigner(BASE_DAI_WHALE) // Reuse alice variable for convenience
      
      usdcContract = new ethers.Contract(BASE_USDC.address, TOKEN_ABI, bob)
      wethContract = new ethers.Contract(BASE_WETH.address, TOKEN_ABI, bob)
      daiContract = new ethers.Contract(BASE_DAI.address, TOKEN_ABI, bob)
      morphoUSDCContract = new ethers.Contract(BASE_MORPHO_USDC_VAULT.address, ERC4626_ABI, bob)
      morphoWETHContract = new ethers.Contract(BASE_MORPHO_WETH_VAULT.address, ERC4626_ABI, bob)
      
      permit2 = PERMIT2.connect(bob) as IPermit2
      router = (await deployUniversalRouter(BASE_WETH.address)) as UniversalRouter
      planner = new RoutePlanner()

      // Give bob tokens from whales
      await usdcContract.connect(usdcWhale).transfer(bob.address, expandTo6DecimalsBN(100000))
      await wethContract.connect(wethWhale).transfer(bob.address, expandTo18DecimalsBN(100))

      await daiContract.connect(alice).transfer(bob.address, expandTo18DecimalsBN(100000))
      // Give alice tokens for liquidity provision
      await usdcContract.connect(usdcWhale).transfer(alice.address, expandTo6DecimalsBN(100000))
      await wethContract.connect(wethWhale).transfer(alice.address, expandTo18DecimalsBN(100))

      // Bob max-approves the permit2 contract
      await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)
      await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
      await daiContract.connect(bob).approve(permit2.address, MAX_UINT)

      // Bob gives the router max approval on permit2
      await permit2.approve(BASE_USDC.address, router.address, MAX_UINT160, DEADLINE)
      await permit2.approve(BASE_WETH.address, router.address, MAX_UINT160, DEADLINE)
      await permit2.approve(BASE_DAI.address, router.address, MAX_UINT160, DEADLINE)
    })

    describe('Case 1: USDC -> wrap -> vault USDC -> swap -> vault WETH -> unwrap -> WETH', () => {
      beforeEach('create liquidity pool with vault tokens', async () => {
        // Get wrapped tokens for the LP
        await wethContract.connect(alice).approve(morphoWETHContract.address, MAX_UINT)
        await usdcContract.connect(alice).approve(morphoUSDCContract.address, MAX_UINT)

        await morphoWETHContract.connect(alice).deposit(expandTo18DecimalsBN(10), alice.address)
        await morphoUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(40000), alice.address)

        const morphoWETHAmount = await morphoWETHContract.balanceOf(alice.address)
        const morphoUSDCAmount = await morphoUSDCContract.balanceOf(alice.address)

        // Create pool with Morpho vault tokens
        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
          morphoUSDCContract.address,
          morphoWETHContract.address,
          ADDRESS_ZERO,
          encodePriceSqrt(morphoWETHAmount, morphoUSDCAmount),
          '0x'
        )

        // Add liquidity to the pool
        await morphoWETHContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
        await morphoUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
          token0: morphoUSDCContract.address,
          token1: morphoWETHContract.address,
          deployer: ADDRESS_ZERO,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: morphoUSDCAmount,
          amount1Desired: morphoWETHAmount,
          amount0Min: 0,
          amount1Min: 0,
          recipient: alice.address,
          deadline: 10000000000000,
        })
      })

      it('ExactInput: 100 USDC -> wrap -> swap -> unwrap -> WETH', async () => {
        const amountInUSDC = expandTo6DecimalsBN(100)
        const expectedMorphoUSDC = BigNumber.from(await morphoUSDCContract.previewDeposit(amountInUSDC))
          .mul(99)
          .div(100)

        const wethBalanceBefore = await wethContract.balanceOf(bob.address)

        // 1. Transfer USDC from user
        // 2. Wrap USDC -> Morpho USDC Vault
        // 3. Swap Morpho USDC -> Morpho WETH
        // 4. Unwrap Morpho WETH -> WETH
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoUSDCContract.address,
          usdcContract.address,
          ADDRESS_THIS,
          amountInUSDC,
          expectedMorphoUSDC,
        ])
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
          encodePathExactInputIntegral([BASE_MORPHO_USDC_VAULT.address, BASE_MORPHO_WETH_VAULT.address]),
          SOURCE_ROUTER,
        ])
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoWETHContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE,
          0,
        ])

        await executeRouter(planner, bob, router, wethContract, daiContract, usdcContract, undefined, DEX.ALGEBRA_INTEGRAL)

        const wethBalanceAfter = await wethContract.balanceOf(bob.address)
        
        expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gt(0)
      })

      it('ExactOutput: USDC -> wrap -> swap -> unwrap -> 0.01 WETH', async () => {
        const amountOutWETH = expandTo18DecimalsBN(0.01)
        const maxAmountInUSDC = expandTo6DecimalsBN(100)

        const wethBalanceBefore = await wethContract.balanceOf(bob.address)
        const usdcBalanceBefore = await usdcContract.balanceOf(bob.address)

        // For exact output, we need to reverse the path
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, maxAmountInUSDC])
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoUSDCContract.address,
          usdcContract.address,
          ADDRESS_THIS,
          maxAmountInUSDC,
          0,
        ])
        
        // Calculate expected morpho WETH for exact output
        const morphoWETHNeeded = await morphoWETHContract.previewWithdraw(amountOutWETH)
        
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS,
          morphoWETHNeeded,
          CONTRACT_BALANCE,
          encodePathExactInputIntegral([BASE_MORPHO_WETH_VAULT.address, BASE_MORPHO_USDC_VAULT.address]), // Reversed!
          SOURCE_ROUTER,
        ])
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoWETHContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE,
          amountOutWETH,
        ])
        // Sweep any remaining morpho USDC back to user
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoUSDCContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE,
          0,
        ])

        await executeRouter(planner, bob, router, wethContract, daiContract, usdcContract, undefined, DEX.ALGEBRA_INTEGRAL)

        const wethBalanceAfter = await wethContract.balanceOf(bob.address)
        const usdcBalanceAfter = await usdcContract.balanceOf(bob.address)

        expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(amountOutWETH)
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(maxAmountInUSDC)
      })
    })

    describe('Case 2: USDC -> swap -> WETH -> wrap -> vault WETH -> swap -> vault USDC -> unwrap -> USDC (Multihop)', () => {
      beforeEach('create both normal and vault pools', async () => {
        // Create normal USDC/WETH pool
        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
          BASE_WETH.address,
          BASE_USDC.address,
          ADDRESS_ZERO,
          encodePriceSqrt(expandTo18DecimalsBN(1), expandTo6DecimalsBN(4000)),
          '0x'
        )

        await usdcContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
        await wethContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
          token0: BASE_WETH.address,
          token1: BASE_USDC.address,
          deployer: ADDRESS_ZERO,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: expandTo18DecimalsBN(10),
          amount1Desired: expandTo6DecimalsBN(40000),
          amount0Min: 0,
          amount1Min: 0,
          recipient: alice.address,
          deadline: 10000000000000,
        })

        // Create vault pool
        await wethContract.connect(alice).approve(morphoWETHContract.address, MAX_UINT)
        await usdcContract.connect(alice).approve(morphoUSDCContract.address, MAX_UINT)

        await morphoWETHContract.connect(alice).deposit(expandTo18DecimalsBN(10), alice.address)
        await morphoUSDCContract.connect(alice).deposit(expandTo6DecimalsBN(40000), alice.address)

        const morphoWETHAmount = await morphoWETHContract.balanceOf(alice.address)
        const morphoUSDCAmount = await morphoUSDCContract.balanceOf(alice.address)

        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
          morphoUSDCContract.address,
          morphoWETHContract.address,
          ADDRESS_ZERO,
          encodePriceSqrt(morphoWETHAmount, morphoUSDCAmount),
          '0x'
        )

        await morphoWETHContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)
        await morphoUSDCContract.connect(alice).approve(INTEGRAL_NFT_POSITION_MANAGER.address, MAX_UINT)

        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).mint({
          token0: morphoUSDCContract.address,
          token1: morphoWETHContract.address,
          deployer: ADDRESS_ZERO,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: morphoUSDCAmount,
          amount1Desired: morphoWETHAmount,
          amount0Min: 0,
          amount1Min: 0,
          recipient: alice.address,
          deadline: 10000000000000,
        })
      })

      it('ExactInput: USDC -> swap -> WETH -> wrap -> swap -> unwrap -> USDC', async () => {
        const amountInUSDC = expandTo6DecimalsBN(100)
        const usdcBalanceBefore = await usdcContract.balanceOf(bob.address)

        // Multihop: USDC -> WETH -> wrap -> morpho WETH -> morpho USDC -> unwrap -> USDC
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
        
        // Step 1: Swap USDC -> WETH
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          amountInUSDC,
          0,
          encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address]),
          SOURCE_ROUTER,
        ])
        
        // Step 2: Wrap WETH -> Morpho WETH
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoWETHContract.address,
          wethContract.address,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
        
        // Step 3: Swap Morpho WETH -> Morpho USDC
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
          encodePathExactInputIntegral([BASE_MORPHO_WETH_VAULT.address, BASE_MORPHO_USDC_VAULT.address]),
          SOURCE_ROUTER,
        ])
        
        // Step 4: Unwrap Morpho USDC -> USDC
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoUSDCContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE,
          0,
        ])

        await executeRouter(planner, bob, router, wethContract, daiContract, usdcContract, undefined, DEX.ALGEBRA_INTEGRAL)

        const usdcBalanceAfter = await usdcContract.balanceOf(bob.address)
        
        // Due to fees and slippage, we should receive less than input
        expect(usdcBalanceAfter).to.be.lt(usdcBalanceBefore)
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(amountInUSDC)
      })

      it('ExactOutput: USDC -> swap -> WETH -> wrap -> swap -> unwrap -> 90 USDC', async () => {
        const amountOutUSDC = expandTo6DecimalsBN(90)
        const maxAmountInUSDC = expandTo6DecimalsBN(100)

        const usdcBalanceBefore = await usdcContract.balanceOf(bob.address)

        // Calculate backwards for exact output
        const morphoUSDCNeeded = await morphoUSDCContract.previewWithdraw(amountOutUSDC)

        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, maxAmountInUSDC])

        // First swap USDC -> WETH
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          maxAmountInUSDC,
          0,
          encodePathExactInputIntegral([BASE_USDC.address, BASE_WETH.address]),
          SOURCE_ROUTER,
        ])

        
        // Wrap WETH -> morpho WETH
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoWETHContract.address,
          wethContract.address,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
        
        // Will be executed in callback, providing morpho USDC
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS,
          morphoUSDCNeeded,
          CONTRACT_BALANCE, // Max morpho WETH we have
          encodePathExactOutputIntegral([BASE_MORPHO_WETH_VAULT.address, BASE_MORPHO_USDC_VAULT.address]),
          SOURCE_ROUTER,
        ])
        
        // Final unwrap vault USDC -> USDC
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoUSDCContract.address,
          MSG_SENDER,
          morphoUSDCNeeded,
          amountOutUSDC,
        ])
        
        // Unwrap any remaining vault WETH -> WETH and return to user
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoWETHContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE, // Unwrap whatever is left
          0, // No minimum
        ])

                // Unwrap any remaining vault WETH -> WETH and return to user
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          morphoWETHContract.address,
          MSG_SENDER,
          CONTRACT_BALANCE, // Unwrap whatever is left
          0, // No minimum
        ])


        await executeRouter(planner, bob, router, wethContract, daiContract, usdcContract, undefined, DEX.ALGEBRA_INTEGRAL)
        
        const usdcBalanceAfter = await usdcContract.balanceOf(bob.address)
        
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(maxAmountInUSDC)
      })
    })

    describe('Case 3: Two wraps and add liquidity', () => {
      it('Wrap both USDC and WETH, then add liquidity to vault pool', async () => {
        const amountInUSDC = expandTo6DecimalsBN(4000)
        const amountInWETH = expandTo18DecimalsBN(1)

        const morphoUSDCExpected = await morphoUSDCContract.previewDeposit(amountInUSDC)
        const morphoWETHExpected = await morphoWETHContract.previewDeposit(amountInWETH)

        // Create pool if not exists
        await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).createAndInitializePoolIfNecessary(
          morphoUSDCContract.address,
          morphoWETHContract.address,
          ADDRESS_ZERO,
          encodePriceSqrt(morphoWETHExpected, morphoUSDCExpected),
          '0x'
        )

        // 1. Transfer both tokens
        // 2. Wrap both to vault tokens
        // 3. Add liquidity
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_WETH.address, router.address, amountInWETH])
        
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoUSDCContract.address,
          usdcContract.address,
          ADDRESS_THIS,
          amountInUSDC,
          morphoUSDCExpected.mul(99).div(100),
        ])
        
        planner.addCommand(CommandType.ERC4626_WRAP, [
          morphoWETHContract.address,
          wethContract.address,
          ADDRESS_THIS,
          amountInWETH,
          morphoWETHExpected.mul(99).div(100),
        ])
        
        planner.addCommand(CommandType.INTEGRAL_MINT, [
          [
            BASE_MORPHO_USDC_VAULT.address,
            BASE_MORPHO_WETH_VAULT.address,
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

        expect(integralPosEventArgs).to.not.be.undefined
        expect(integralPosEventArgs![0].tokenId).to.be.gt(0)

        // Verify position was created
        const tokenId = integralPosEventArgs![0].tokenId
        const position = await INTEGRAL_NFT_POSITION_MANAGER.connect(alice).positions(tokenId)

        expect(position.liquidity).to.be.gt(0)
        expect(position.token0).to.equal(morphoUSDCContract.address)
        expect(position.token1).to.equal(morphoWETHContract.address)
      })
    })

    describe('New Path Format with Action Flags', () => {
      it('ExactInput: USDC → [WRAP] → vaultUSDC → [SWAP] → vaultWETH → [UNWRAP] → WETH', async () => {
        const { encodePathExactInputIntegralWithFlags, ACTION_FLAG_WRAP, ACTION_FLAG_SWAP, ACTION_FLAG_UNWRAP } =
          await import('./shared/swapRouter02Helpers')

        const amountInUSDC = expandTo6DecimalsBN(100)
        const minAmountOutWETH = expandTo18DecimalsBN(0.02)

        const morphoUSDCContract = new ethers.Contract(BASE_MORPHO_USDC_VAULT.address, ERC4626_ABI, alice)
        const morphoWETHContract = new ethers.Contract(BASE_MORPHO_WETH_VAULT.address, ERC4626_ABI, alice)

        // New path format: token0 + flag + aux + deployer + token1 + flag + aux + deployer + token2
        // USDC → [WRAP, vaultUSDC] → vaultUSDC → [SWAP, 0x0] → vaultWETH → [UNWRAP, vaultWETH] → WETH
        const path = encodePathExactInputIntegralWithFlags(
          [BASE_USDC.address, BASE_MORPHO_USDC_VAULT.address, BASE_MORPHO_WETH_VAULT.address, BASE_WETH.address],
          [ACTION_FLAG_WRAP, ACTION_FLAG_SWAP, ACTION_FLAG_UNWRAP],
          [BASE_MORPHO_USDC_VAULT.address, ZERO_ADDRESS, BASE_MORPHO_WETH_VAULT.address]
        )

        console.log('Initial USDC balance:', (await usdcContract.balanceOf(bob.address)).toString())
        console.log('Initial WETH balance:', (await wethContract.balanceOf(bob.address)).toString())

        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [BASE_USDC.address, router.address, amountInUSDC])
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          MSG_SENDER,
          amountInUSDC,
          minAmountOutWETH,
          path,
          SOURCE_ROUTER, // Router has the funds after PERMIT2_TRANSFER_FROM
        ])

        const { wethBalanceBefore, wethBalanceAfter, usdcBalanceAfter, usdcBalanceBefore } = await executeRouter(
          planner,
          bob,
          router,
          wethContract,
          daiContract,
          usdcContract,
          undefined,
          DEX.ALGEBRA_INTEGRAL
        )

        console.log('Final USDC balance:', usdcBalanceAfter.toString())
        console.log('Final WETH balance:', wethBalanceAfter.toString())
        console.log('WETH received:', wethBalanceAfter.sub(wethBalanceBefore).toString())

        expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOutWETH)
        expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.eq(amountInUSDC)

        // Verify router has no leftover balances
        expect(await usdcContract.balanceOf(router.address)).to.eq(0)
        expect(await wethContract.balanceOf(router.address)).to.eq(0)
        expect(await morphoUSDCContract.balanceOf(router.address)).to.eq(0)
        expect(await morphoWETHContract.balanceOf(router.address)).to.eq(0)
      })
    })
  })
})
