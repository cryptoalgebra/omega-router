import type { Contract } from '@ethersproject/contracts'
import { expect } from './shared/expect'
import { BigNumber } from 'ethers'
import { IPermit2, UniversalRouter } from '../../typechain'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json';
import { resetFork,
  MAINNET_WETH,
  MAINNET_DAI,
  MAINNET_USDC,
  MAINNET_WA_USDC,
  PERMIT2,
  MAINNET_USDC_WHALE
} from './shared/mainnetForkHelpers'
import {
  DEADLINE,
  MAX_UINT,
  MAX_UINT160,
} from './shared/constants'
import { expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import deployUniversalRouter from './shared/deployUniversalRouter'
import { RoutePlanner, CommandType } from './shared/planner'
import hre from 'hardhat'
import { executeRouter } from './shared/executeRouter'
const { ethers } = hre

describe('ERC4626 Wrap/Unwrap Tests:', () => {
  let bob: SignerWithAddress
  let router: UniversalRouter
  let permit2: IPermit2
  let daiContract: Contract
  let wethContract: Contract
  let usdcContract: Contract
  let waUsdcContract: Contract
  let planner: RoutePlanner

  beforeEach(async () => {
    await resetFork(23377219)

    bob = (await ethers.getSigners())[1]
    daiContract = new ethers.Contract( MAINNET_DAI.address, TOKEN_ABI, bob)
    wethContract = new ethers.Contract( MAINNET_WETH.address, TOKEN_ABI, bob)
    usdcContract = new ethers.Contract( MAINNET_USDC.address, TOKEN_ABI, bob)
    waUsdcContract = new ethers.Contract(MAINNET_WA_USDC.address, ERC4626_ABI, bob)
    permit2 = PERMIT2.connect(bob) as IPermit2
    router = (await deployUniversalRouter(bob.address)) as UniversalRouter
    planner = new RoutePlanner()

    const usdcWhale = await ethers.getSigner( MAINNET_USDC_WHALE)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [ MAINNET_USDC_WHALE],
    })
    await usdcContract.connect(usdcWhale).transfer(bob.address, expandTo6DecimalsBN(100000))

    // Bob max-approves the permit2 contract to access his  MAINNET_DAI and  MAINNET_WETH
    await daiContract.connect(bob).approve(permit2.address, MAX_UINT)
    await wethContract.connect(bob).approve(permit2.address, MAX_UINT)
    await usdcContract.connect(bob).approve(permit2.address, MAX_UINT)
    await waUsdcContract.connect(bob).approve(permit2.address, MAX_UINT)

    // for these tests Bob gives the router max approval on permit2
    await permit2.approve( MAINNET_DAI.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve( MAINNET_USDC.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve( MAINNET_WETH.address, router.address, MAX_UINT160, DEADLINE)
    await permit2.approve(MAINNET_WA_USDC.address, router.address, MAX_UINT160, DEADLINE)
  })

  it('Wrap USDC -> Aave USDC', async () => {
    const amountInUSDC = expandTo6DecimalsBN(100)
    const expectedAmountOutWaUSDC = BigNumber.from(await waUsdcContract.previewDeposit(amountInUSDC))

    // 1) transferFrom the funds,
    // 2) perform wrap
    planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [MAINNET_USDC.address, router.address, amountInUSDC])
    planner.addCommand(CommandType.ERC4626_WRAP, [
      waUsdcContract.address,
      usdcContract.address,
      amountInUSDC,
      expectedAmountOutWaUSDC
    ])
    await executeRouter(
      planner,
      bob,
      router,
      wethContract,
      daiContract,
      usdcContract
    )

    const receivedWaUSDC = await waUsdcContract.balanceOf(router.address)
    expect(receivedWaUSDC).to.be.eq(expectedAmountOutWaUSDC)
  })

  it('Unwrap Aave USDC -> USDC', async () => {
    // Obtain waUSDC for the test
    await usdcContract.connect(bob).approve(waUsdcContract.address, MAX_UINT)
    await waUsdcContract.deposit(expandTo6DecimalsBN(100), bob.address)
    const amountInWaUSDC = await waUsdcContract.balanceOf(bob.address)

    const expectedAmountOutUSDC = BigNumber.from(await waUsdcContract.previewRedeem(amountInWaUSDC))

    // 1) transferFrom the funds,
    // 2) perform unwrap
    planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [MAINNET_WA_USDC.address, router.address, amountInWaUSDC])
    planner.addCommand(CommandType.ERC4626_UNWRAP, [
      waUsdcContract.address,
      usdcContract.address,
      amountInWaUSDC,
      expectedAmountOutUSDC
    ])
    await executeRouter(
      planner,
      bob,
      router,
      wethContract,
      daiContract,
      usdcContract
    )

    const receivedUSDC = await usdcContract.balanceOf(router.address)
    expect(receivedUSDC).to.be.eq(expectedAmountOutUSDC)
  })
})
