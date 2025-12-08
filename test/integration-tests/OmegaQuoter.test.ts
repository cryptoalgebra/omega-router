import { expect } from './shared/expect'
import { OmegaQuoter } from '../../typechain'
import { abi as ERC4626_ABI } from '../../artifacts/@openzeppelin/contracts/interfaces/IERC4626.sol/IERC4626.json'
import {
  resetFork,
  MAINNET_WETH,
  MAINNET_DAI,
  MAINNET_USDC,
  MAINNET_WA_USDC,
  BASE_WETH,
  BASE_USDC,
  BASE_DAI,
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
} from './shared/constants'
import { expandTo18DecimalsBN, expandTo6DecimalsBN } from './shared/helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CommandType } from './shared/planner'
import { defaultAbiCoder } from 'ethers/lib/utils'
import hre from 'hardhat'
import {
  encodePathExactInput,
  encodePathExactOutput,
  encodePathExactInputIntegral,
  encodePathExactOutputIntegral,
} from './shared/swapRouter02Helpers'
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

        const commands = '0x' + CommandType.V2_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'address[]'], [amountIn, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut] = defaultAbiCoder.decode(['uint256'], outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      })

      it('quotes exactOut swap: DAI -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(1)
        const path = [MAINNET_DAI.address, MAINNET_WETH.address]

        const commands = '0x' + CommandType.V2_SWAP_EXACT_OUT.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'address[]'], [amountOut, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountIn] = defaultAbiCoder.decode(['uint256'], outputs[0])
        expect(amountIn).to.be.gt(expandTo18DecimalsBN(3000))
        expect(amountIn).to.be.lt(expandTo18DecimalsBN(6000))
      })

      it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = [MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address]

        const commands = '0x' + CommandType.V2_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'address[]'], [amountIn, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut] = defaultAbiCoder.decode(['uint256'], outputs[0])
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      })
    })

    describe('V3 Quoter', () => {
      it('quotes exactIn swap: DAI -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_WETH.address])

        const commands = '0x' + CommandType.UNISWAP_V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
          ['uint256', 'uint160[]', 'uint256'],
          outputs[0]
        )
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
        expect(sqrtPriceX96AfterList.length).to.equal(1)
        expect(gasEstimate).to.be.gt(0)
      })

      it('quotes exactOut swap: DAI -> WETH', async () => {
        const amountOut = expandTo18DecimalsBN(1)
        const path = encodePathExactOutput([MAINNET_DAI.address, MAINNET_WETH.address])

        const commands = '0x' + CommandType.UNISWAP_V3_SWAP_EXACT_OUT.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountOut, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountIn, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
          ['uint256', 'uint160[]', 'uint256'],
          outputs[0]
        )
        expect(amountIn).to.be.gt(expandTo18DecimalsBN(3000))
        expect(amountIn).to.be.lt(expandTo18DecimalsBN(6000))
        expect(sqrtPriceX96AfterList.length).to.equal(1)
        expect(gasEstimate).to.be.gt(0)
      })

      it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
        const amountIn = expandTo18DecimalsBN(100)
        const path = encodePathExactInput([MAINNET_DAI.address, MAINNET_USDC.address, MAINNET_WETH.address])

        const commands = '0x' + CommandType.UNISWAP_V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, path])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
          ['uint256', 'uint160[]', 'uint256'],
          outputs[0]
        )
        expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
        expect(sqrtPriceX96AfterList.length).to.equal(2) // 2 pools
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

        const commands = '0x' + CommandType.ERC4626_WRAP.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['address', 'uint256'], [MAINNET_WA_USDC.address, amountIn])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut] = defaultAbiCoder.decode(['uint256'], outputs[0])
        const expectedAmountOut = await waUsdcContract.previewDeposit(amountIn)
        expect(amountOut).to.equal(expectedAmountOut)
      })

      it('quotes unwrap: waUSDC -> USDC', async () => {
        const waUsdcContract = new ethers.Contract(MAINNET_WA_USDC.address, ERC4626_ABI, bob)
        const amountIn = expandTo6DecimalsBN(100)

        const commands = '0x' + CommandType.ERC4626_UNWRAP.toString(16).padStart(2, '0')
        const inputs = [defaultAbiCoder.encode(['address', 'uint256'], [MAINNET_WA_USDC.address, amountIn])]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(1)

        const [amountOut] = defaultAbiCoder.decode(['uint256'], outputs[0])
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

        const commands =
          '0x' +
          CommandType.UNISWAP_V3_SWAP_EXACT_IN.toString(16).padStart(2, '0') +
          CommandType.V2_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [
          defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, pathV3]),
          defaultAbiCoder.encode(['uint256', 'address[]'], [CONTRACT_BALANCE, pathV2]),
        ]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const [amountOutV3] = defaultAbiCoder.decode(['uint256', 'uint160[]', 'uint256'], outputs[0])
        expect(amountOutV3).to.be.gt(expandTo18DecimalsBN(0.02))

        const [amountOutV2] = defaultAbiCoder.decode(['uint256'], outputs[1])
        expect(amountOutV2).to.be.gt(expandTo6DecimalsBN(80))
      })

      it('quotes V2 swap -> V3 swap using CONTRACT_BALANCE', async () => {
        const amountIn = expandTo18DecimalsBN(100)

        // First swap: DAI -> USDC on V2
        const pathV2 = [MAINNET_DAI.address, MAINNET_USDC.address]
        // Second swap: USDC -> WETH on V3, using output from first swap
        const pathV3 = encodePathExactInput([MAINNET_USDC.address, MAINNET_WETH.address])

        const commands =
          '0x' +
          CommandType.V2_SWAP_EXACT_IN.toString(16).padStart(2, '0') +
          CommandType.UNISWAP_V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')
        const inputs = [
          defaultAbiCoder.encode(['uint256', 'address[]'], [amountIn, pathV2]),
          defaultAbiCoder.encode(['uint256', 'bytes'], [CONTRACT_BALANCE, pathV3]),
        ]

        const outputs = await quoter.callStatic.execute(commands, inputs)
        expect(outputs.length).to.equal(2)

        const [amountOutV2] = defaultAbiCoder.decode(['uint256'], outputs[0])
        expect(amountOutV2).to.be.gt(expandTo6DecimalsBN(95))

        const [amountOutV3] = defaultAbiCoder.decode(['uint256', 'uint160[]', 'uint256'], outputs[1])
        expect(amountOutV3).to.be.gt(expandTo18DecimalsBN(0.02))
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

      const commands = '0x' + CommandType.INTEGRAL_SWAP_EXACT_IN.toString(16).padStart(2, '0')
      const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, path])]

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const [amountOut, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
        ['uint256', 'uint160[]', 'uint256'],
        outputs[0]
      )
      expect(amountOut).to.be.gt(expandTo18DecimalsBN(0.02))
      expect(sqrtPriceX96AfterList.length).to.equal(1)
      expect(gasEstimate).to.be.gt(0)
    })

    it('quotes exactOut swap: USDC -> WETH', async () => {
      const amountOut = expandTo18DecimalsBN(0.01)
      const path = encodePathExactOutputIntegral([BASE_USDC.address, BASE_WETH.address])

      const commands = '0x' + CommandType.INTEGRAL_SWAP_EXACT_OUT.toString(16).padStart(2, '0')
      const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountOut, path])]

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const [amountIn, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
        ['uint256', 'uint160[]', 'uint256'],
        outputs[0]
      )
      expect(amountIn).to.be.gt(expandTo6DecimalsBN(30))
      expect(amountIn).to.be.lt(expandTo6DecimalsBN(60))
      expect(sqrtPriceX96AfterList.length).to.equal(1)
      expect(gasEstimate).to.be.gt(0)
    })

    it('quotes multihop exactIn: DAI -> USDC -> WETH', async () => {
      const amountIn = expandTo18DecimalsBN(100)
      const path = encodePathExactInputIntegral([BASE_DAI.address, BASE_USDC.address, BASE_WETH.address])

      const commands = '0x' + CommandType.INTEGRAL_SWAP_EXACT_IN.toString(16).padStart(2, '0')
      const inputs = [defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, path])]

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(1)

      const [amountOut, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
        ['uint256', 'uint160[]', 'uint256'],
        outputs[0]
      )
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

      const commands =
        '0x' +
        CommandType.INTEGRAL_SWAP_EXACT_IN.toString(16).padStart(2, '0') +
        CommandType.INTEGRAL_SWAP_EXACT_IN.toString(16).padStart(2, '0')
      const inputs = [
        defaultAbiCoder.encode(['uint256', 'bytes'], [amountIn, pathFirst]),
        defaultAbiCoder.encode(['uint256', 'bytes'], [CONTRACT_BALANCE, pathSecond]),
      ]

      const outputs = await quoter.callStatic.execute(commands, inputs)
      expect(outputs.length).to.equal(2)

      const [amountOutFirst] = defaultAbiCoder.decode(['uint256', 'uint160[]', 'uint256'], outputs[0])
      expect(amountOutFirst).to.be.gt(expandTo6DecimalsBN(95))

      const [amountOutSecond] = defaultAbiCoder.decode(['uint256', 'uint160[]', 'uint256'], outputs[1])
      expect(amountOutSecond).to.be.gt(expandTo18DecimalsBN(0.02))
    })
  })
})
