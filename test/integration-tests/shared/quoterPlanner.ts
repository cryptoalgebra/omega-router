import { defaultAbiCoder } from 'ethers/lib/utils'
import { CommandType } from './planner'
import { BigNumber } from 'ethers'

/**
 * QuoterPlanner
 * @description Helper class for building quoter command sequences
 * Similar to RoutePlanner but designed specifically for quoter execute() calls
 */
export class QuoterPlanner {
  commands: string
  inputs: string[]

  constructor() {
    this.commands = '0x'
    this.inputs = []
  }

  /**
   * Add a V2 exact input swap quote command
   */
  addV2SwapExactIn(amountIn: any, path: string[]): void {
    this.addCommand(CommandType.V2_SWAP_EXACT_IN, ['uint256', 'address[]'], [amountIn, path])
  }

  /**
   * Add a V2 exact output swap quote command
   */
  addV2SwapExactOut(amountOut: any, path: string[]): void {
    this.addCommand(CommandType.V2_SWAP_EXACT_OUT, ['uint256', 'address[]'], [amountOut, path])
  }

  /**
   * Add a V3 exact input swap quote command
   */
  addV3SwapExactIn(amountIn: any, path: string): void {
    this.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, ['uint256', 'bytes'], [amountIn, path])
  }

  /**
   * Add a V3 exact output swap quote command
   */
  addV3SwapExactOut(amountOut: any, path: string): void {
    this.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_OUT, ['uint256', 'bytes'], [amountOut, path])
  }

  /**
   * Add an Integral exact input swap quote command
   */
  addIntegralSwapExactIn(amountIn: any, path: string): void {
    this.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, ['uint256', 'bytes'], [amountIn, path])
  }

  /**
   * Add an Integral exact output swap quote command
   */
  addIntegralSwapExactOut(amountOut: any, path: string): void {
    this.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, ['uint256', 'bytes'], [amountOut, path])
  }

  /**
   * Add an ERC4626 wrap quote command
   */
  addERC4626Wrap(wrapper: string, amountIn: any): void {
    this.addCommand(CommandType.ERC4626_WRAP, ['address', 'uint256'], [wrapper, amountIn])
  }

  /**
   * Add an ERC4626 unwrap quote command
   */
  addERC4626Unwrap(wrapper: string, amountIn: any): void {
    this.addCommand(CommandType.ERC4626_UNWRAP, ['address', 'uint256'], [wrapper, amountIn])
  }

  /**
   * Add a sub-plan execution command
   */
  addSubPlan(subplan: QuoterPlanner): void {
    const encodedInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], [subplan.commands, subplan.inputs])
    this.inputs.push(encodedInput)
    this.commands = this.commands.concat(CommandType.EXECUTE_SUB_PLAN.toString(16).padStart(2, '0'))
  }

  /**
   * Internal method to add a command with encoded inputs
   */
  private addCommand(type: CommandType, types: string[], values: any[]): void {
    const encodedInput = defaultAbiCoder.encode(types, values)
    this.inputs.push(encodedInput)
    this.commands = this.commands.concat(type.toString(16).padStart(2, '0'))
  }

  /**
   * Get the final commands and inputs for quoter.execute()
   */
  finalize(): { commands: string; inputs: string[] } {
    return {
      commands: this.commands,
      inputs: this.inputs,
    }
  }
}

/**
 * Result types for different quote operations
 */
export interface V2QuoteResult {
  amountOut: BigNumber
}

export interface V3QuoteResult {
  amountOut: BigNumber
  sqrtPriceX96AfterList: BigNumber[]
  gasEstimate: BigNumber
}

export interface ERC4626QuoteResult {
  amountOut: BigNumber
}

/**
 * QuoterResultParser
 * @description Helper class for parsing quoter output results
 */
export class QuoterResultParser {
  /**
   * Parse V2 swap quote result (exactIn or exactOut)
   */
  static parseV2SwapResult(output: string): V2QuoteResult {
    const [amountOut] = defaultAbiCoder.decode(['uint256'], output)
    return { amountOut }
  }

  /**
   * Parse V3/Integral swap quote result (exactIn or exactOut)
   */
  static parseV3SwapResult(output: string): V3QuoteResult {
    const [amountOut, sqrtPriceX96AfterList, gasEstimate] = defaultAbiCoder.decode(
      ['uint256', 'uint160[]', 'uint256'],
      output
    )
    return { amountOut, sqrtPriceX96AfterList, gasEstimate }
  }

  /**
   * Parse ERC4626 wrap/unwrap quote result
   */
  static parseERC4626Result(output: string): ERC4626QuoteResult {
    const [amountOut] = defaultAbiCoder.decode(['uint256'], output)
    return { amountOut }
  }

  /**
   * Parse V3/Integral swap quote result for exactIn (alias for clarity)
   */
  static parseV3ExactInResult(output: string): V3QuoteResult {
    return this.parseV3SwapResult(output)
  }

  /**
   * Parse V3/Integral swap quote result for exactOut (alias for clarity)
   * Returns amountIn instead of amountOut, but structure is the same
   */
  static parseV3ExactOutResult(output: string): V3QuoteResult & { amountIn: BigNumber } {
    const result = this.parseV3SwapResult(output)
    return { ...result, amountIn: result.amountOut }
  }

  /**
   * Parse V2 swap quote result for exactOut (alias for clarity)
   * Returns amountIn instead of amountOut
   */
  static parseV2ExactOutResult(output: string): V2QuoteResult & { amountIn: BigNumber } {
    const result = this.parseV2SwapResult(output)
    return { ...result, amountIn: result.amountOut }
  }

  /**
   * Parse Integral swap quote result (same as V3)
   */
  static parseIntegralSwapResult(output: string): V3QuoteResult {
    return this.parseV3SwapResult(output)
  }
}
