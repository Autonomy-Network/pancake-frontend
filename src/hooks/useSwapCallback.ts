import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { ethers } from 'ethers'
import { JSBI, Percent, Router, Trade, TradeType, ChainId } from '@pancakeswap/sdk'
import { TRASNFER_FEE_TOKEN_ADDRESS_LIST, REFERER_ADDRESS } from 'config/constants/autonomy'
import { useMemo } from 'react'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { useGasPrice, useAutonomyPaymentManager } from 'state/user/hooks'
import getGasPrice from 'utils/getGasPrice'
import { WBNB } from 'config/constants/tokens'
import { BIPS_BASE, INITIAL_ALLOWED_SLIPPAGE, MAX_GAS_PRICE } from '../config/constants'
import { useTransactionAdder } from '../state/transactions/hooks'
import { calculateGasMargin, getRouterContract, isAddress, shortenAddress } from '../utils'
import isZero from '../utils/isZero'
import useTransactionDeadline from './useTransactionDeadline'
import useENS from './ENS/useENS'
import { useRegistryContract, useMidRouterContract } from './useContract'

export enum SwapCallbackState {
  INVALID,
  LOADING,
  VALID,
}

interface SwapCall {
  contract: Contract
  parameters: {
    methodName: string
    args: any[]
    value: string
  }
}

interface SuccessfulCall {
  call: SwapCall
  gasEstimate: BigNumber
}

interface FailedCall {
  call: SwapCall
  error: Error
}

type EstimatedSwapCall = SuccessfulCall | FailedCall

/**
 * Returns the swap calls that can be used to make the trade
 * @param trade trade to execute
 * @param allowedSlippage user allowed slippage
 * @param recipientAddressOrName
 */
function useSwapCallArguments(
  trade: Trade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE, // in bips
  recipientAddressOrName: string | null, // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
): SwapCall[] {
  const { account, chainId, library } = useActiveWeb3React()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress
  const deadline = useTransactionDeadline()

  return useMemo(() => {
    if (!trade || !recipient || !library || !account || !chainId || !deadline) return []

    const contract: Contract | null = getRouterContract(chainId, library, account)
    if (!contract) {
      return []
    }

    const swapMethods = []

    swapMethods.push(
      // @ts-ignore
      Router.swapCallParameters(trade, {
        feeOnTransfer: false,
        allowedSlippage: new Percent(JSBI.BigInt(allowedSlippage), BIPS_BASE),
        recipient,
        deadline: deadline.toNumber(),
      }),
    )

    if (trade.tradeType === TradeType.EXACT_INPUT) {
      swapMethods.push(
        // @ts-ignore
        Router.swapCallParameters(trade, {
          feeOnTransfer: false,
          allowedSlippage: new Percent(JSBI.BigInt(allowedSlippage), BIPS_BASE),
          recipient,
          deadline: deadline.toNumber(),
        }),
      )
    }

    return swapMethods.map((parameters) => ({ parameters, contract }))
  }, [account, allowedSlippage, chainId, deadline, library, recipient, trade])
}

function useAutonomySwapCallArguments(
  trade: Trade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE, // in bips
  recipientAddressOrName: string | null,
  tradeLimitType: string | undefined,
  outputMinMaxAmount: string | undefined,
): SwapCall[] {
  const { account } = useActiveWeb3React()

  const midRouterContract = useMidRouterContract()
  const registryContract = useRegistryContract()
  const [autonomyPrepay] = useAutonomyPaymentManager()

  const swapCalls: SwapCall[] = useSwapCallArguments(trade, allowedSlippage, recipientAddressOrName)

  return useMemo(() => {
    const inputCurrencyDecimals = trade?.inputAmount.currency.decimals || 18
    const outputCurrencyDecimals = trade?.outputAmount.currency.decimals || 18

    let inputAmount: BigNumber | undefined
    let outputAmount: BigNumber | undefined

    try {
      inputAmount = trade?.inputAmount
        ? ethers.utils.parseEther(trade?.inputAmount.toSignificant(6)).div(10 ** (18 - inputCurrencyDecimals))
        : undefined
      outputAmount = outputMinMaxAmount
        ? ethers.utils.parseEther(outputMinMaxAmount).div(10 ** (18 - outputCurrencyDecimals))
        : undefined
    } catch (e) {
      // For math errors with too tiny holding values
      inputAmount = undefined
      outputAmount = undefined
    }

    if (!trade || !midRouterContract || !registryContract || !tradeLimitType || !inputAmount || !outputAmount)
      return swapCalls

    return swapCalls.map(({ parameters: { methodName, args, value }, contract }) => {
      const params = [contract.address, ...args]
      let calldata = '0x0'
      let ethForCall = '0x0'
      let swapMethod
      let swapArgs
      let verifySender = true
      let insertFeeAmount = false

      switch (methodName) {
        case 'swapExactETHForTokens':
        case 'swapETHForExactTokens':
        case 'swapExactETHForTokensSupportingFeeOnTransferTokens':
          swapMethod = tradeLimitType === 'limit-order' ? 'ethToTokenRange' : 'ethToTokenRange'
          swapArgs = [
            MAX_GAS_PRICE,
            params[0],
            outputAmount,
            BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935'),
            params[2], 
            params[3],
            params[4]
        ]       
           if (!autonomyPrepay) {
            swapMethod = `${swapMethod}PayDefault`
            swapArgs = [
              params[3],
              '0x0',
              MAX_GAS_PRICE,
              params[0],
              outputAmount,
              (BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935')).div(BigNumber.from(10).mul(BigNumber.from(inputAmount))),
              params[2],
              params[4]
          ]
            insertFeeAmount = true
          } else {
            verifySender = false
          }
          if (tradeLimitType === 'stop-loss') {
            if (!autonomyPrepay) {
              swapArgs = [
                params[3],
                '0x0',
                MAX_GAS_PRICE,
                params[0],
                BigNumber.from('0'), 
                outputAmount,
                params[2],
                params[4]
            ]
            } else {
              swapArgs = [
                MAX_GAS_PRICE,
                params[0],
                BigNumber.from('0'), 
                outputAmount,
                params[2], 
                params[3],
                params[4]
            ] 
            }
          }
          calldata = midRouterContract.interface.encodeFunctionData(swapMethod, swapArgs)
          ethForCall = value
          break
        case 'swapExactTokensForETH':
        case 'swapTokensForExactETH':
        case 'swapExactTokensForETHSupportingFeeOnTransferTokens':
          swapMethod = tradeLimitType === 'limit-order' ? 'tokenToEthRange' : 'tokenToEthRange'

          swapArgs = [
            account,
            MAX_GAS_PRICE,
            params[0],
            inputAmount,
            outputAmount,
            BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935'), 
            params[3],
            params[4],
            params[5]
        ]
          if (!autonomyPrepay) {
            swapMethod = `${swapMethod}PayDefault`
            swapArgs = [
              account,
              '0x0',
              MAX_GAS_PRICE,
              params[0],
              inputAmount,
              (BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935')).div(BigNumber.from(10).mul(BigNumber.from(inputAmount))),
              outputAmount,
              params[3],
              params[5]
          ]
            insertFeeAmount = true
          }
          if (tradeLimitType === 'stop-loss') {
            
            if (!autonomyPrepay) {
              swapArgs = [
                account,
                '0x0',
                MAX_GAS_PRICE,
                params[0],
                inputAmount,
                BigNumber.from('0'), 
                outputAmount,
                params[3],
                params[5]
            ]
            } else {
              swapArgs = [
                account,
                MAX_GAS_PRICE,
                params[0],
                inputAmount,
                BigNumber.from('0'), 
                outputAmount,
                params[3],
                params[4],
                params[5]
            ]
            }
          }
          calldata = midRouterContract.interface.encodeFunctionData(swapMethod, swapArgs)
          break
        case 'swapExactTokensForTokens':
        case 'swapTokensForExactTokens':
        case 'swapExactTokensForTokensSupportingFeeOnTransferTokens':
          swapMethod = tradeLimitType === 'limit-order' ? 'tokenToTokenRange' : 'tokenToTokenRange'
          swapArgs = [
            account,
            MAX_GAS_PRICE,
            params[0],
            inputAmount,
            outputAmount,
            BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935'), /* this is solidity max uint  */                     
            params[3],
            params[4],
            params[5]
        ]
        if (!autonomyPrepay) {
            swapMethod = `${swapMethod}PayDefault`
            swapArgs = [
                account,
                '0x0',
                MAX_GAS_PRICE,
                params[0],
                inputAmount,
                outputAmount,
                (BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935')).div(BigNumber.from(10).mul(BigNumber.from(inputAmount))),                     
                params[3],
                params[5]
            ]
            insertFeeAmount = true
        }
        if (tradeLimitType === 'stop-loss') {
            if (!autonomyPrepay) {
                swapArgs = [
                    account,
                    '0x0',
                    MAX_GAS_PRICE,
                    params[0],
                    inputAmount,
                    BigNumber.from('0'),
                    outputAmount,
                    params[3],
                    params[5]
                ]
            } else {
                swapArgs = [
                    account,
                    MAX_GAS_PRICE,
                    params[0],
                    inputAmount,
                    BigNumber.from('0'),
                    outputAmount,
                    params[3],
                    params[4],
                    params[5]
                ]
            }
        }
          calldata = midRouterContract.interface.encodeFunctionData(swapMethod, swapArgs)
          break
        default:
          break
      }
      const wrapperArgs = [
        midRouterContract.address,
        REFERER_ADDRESS,
        calldata,
        BigNumber.from(ethForCall),
        verifySender,
        insertFeeAmount, // set insertFeeAmount as true for Paydefault
        false,
      ]
      // const wrapperCalldata = registryContract.interface.encodeFunctionData('newReq', wrapperArgs)
      // Cap original value with autonomy fee - 0.01 ether
      const wrapperValue = autonomyPrepay
        ? BigNumber.from(value).add(ethers.utils.parseEther('0.01')).toHexString()
        : BigNumber.from(value).toHexString()

      return {
        parameters: { methodName: 'newReq', args: wrapperArgs, value: wrapperValue },
        contract: registryContract,
      }
    })
  }, [
    swapCalls,
    midRouterContract,
    registryContract,
    autonomyPrepay,
    account,
    outputMinMaxAmount,
    trade,
    tradeLimitType,
  ])
}

// returns a function that will execute a swap, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the trade
export function useSwapCallback(
  trade: Trade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE, // in bips
  recipientAddressOrName: string | null, // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
  tradeLimitType?: string,
  outputMinMaxAmount?: string,
): { state: SwapCallbackState; callback: null | (() => Promise<string>); error: string | null } {
  const { account, chainId, library } = useActiveWeb3React()
  const gasPrice = useGasPrice()

  const [autonomyPrepay] = useAutonomyPaymentManager()

  const swapCalls = useAutonomySwapCallArguments(
    trade,
    allowedSlippage,
    recipientAddressOrName,
    tradeLimitType,
    outputMinMaxAmount,
  )

  const routerContract = getRouterContract(chainId, library, account)

  const addTransaction = useTransactionAdder()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress

  return useMemo(() => {
    if (!trade || !library || !account || !chainId) {
      return { state: SwapCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }
    if (!recipient) {
      if (recipientAddressOrName !== null) {
        return { state: SwapCallbackState.INVALID, callback: null, error: 'Invalid recipient' }
      }
      return { state: SwapCallbackState.LOADING, callback: null, error: null }
    }

    return {
      state: SwapCallbackState.VALID,
      callback: async function onSwap(): Promise<string> {
        const estimatedCalls: EstimatedSwapCall[] = await Promise.all(
          swapCalls.map((call) => {
            const {
              parameters: { methodName, args, value },
              contract,
            } = call
            const options = !value || isZero(value) ? {} : { value }

            return contract.estimateGas[methodName](...args, options)
              .then((gasEstimate) => {
                return {
                  call,
                  gasEstimate,
                }
              })
              .catch((gasError) => {
                console.error('Gas estimate failed, trying eth_call to extract error', call)

                return contract.callStatic[methodName](...args, options)
                  .then((result) => {
                    console.error('Unexpected successful call after failed estimate gas', call, gasError, result)
                    return { call, error: new Error('Unexpected issue with estimating the gas. Please try again.') }
                  })
                  .catch((callError) => {
                    console.error('Call threw error', call, callError)
                    const reason: string = callError.reason || callError.data?.message || callError.message
                    const errorMessage = `The transaction cannot succeed due to error: ${reason ?? 'Unknown error, check the logs'
                      }.`

                    return { call, error: new Error(errorMessage) }
                  })
              })
          }),
        )

        // a successful estimation is a bignumber gas estimate and the next call is also a bignumber gas estimate
        const successfulEstimation = estimatedCalls.find(
          (el, ix, list): el is SuccessfulCall =>
            'gasEstimate' in el && (ix === list.length - 1 || 'gasEstimate' in list[ix + 1]),
        )

        if (!successfulEstimation) {
          const errorCalls = estimatedCalls.filter((call): call is FailedCall => 'error' in call)
          if (errorCalls.length > 0) throw errorCalls[errorCalls.length - 1].error
          throw new Error('Unexpected error. Please contact support: none of the calls threw an error')
        }

        const {
          call: {
            contract,
            parameters: { methodName, args, value },
          },
          gasEstimate,
        } = successfulEstimation

        // TODO: check Pre-pay fee vs Input Token value
        if (!autonomyPrepay) {
          const gasFee = BigNumber.from('300000').mul(getGasPrice())
          const inputCurrencyDecimals = trade.inputAmount.currency.decimals || 18
          const inputTokenAmount = ethers.utils
            .parseEther(trade.inputAmount.toSignificant(6))
            .div(10 ** (18 - inputCurrencyDecimals))
          let isEligible = false
          if (trade.route.path[0].address === WBNB.address) {
            // In case input token is BNB
            isEligible = inputTokenAmount.gt(gasFee)
          } else {
            const [, bnbAmount] = await routerContract.getAmountsOut(inputTokenAmount, [
              trade.route.path[0].address,
              WBNB.address,
            ])
            isEligible = (bnbAmount as BigNumber).gt(gasFee)
          }
          if (!isEligible && !window.location.href.includes('swap')) {
            throw new Error('It is unlikely that this amount is enough to cover the cost of execution')
        }
          // @ts-ignore
          if (TRASNFER_FEE_TOKEN_ADDRESS_LIST[chainId || ChainId.MAINNET].includes(trade.inputAmount.currency.address || 'NonAddress')) {
            throw new Error("Fee On Transfer isn't supported for limits and stops")
          }
        }

        return contract[methodName](...args, {
          gasLimit: calculateGasMargin(gasEstimate),
          gasPrice,
          ...(value && !isZero(value) ? { value, from: account } : { from: account }),
        })
          .then((response: any) => {
            const inputSymbol = trade.inputAmount.currency.symbol
            const outputSymbol = trade.outputAmount.currency.symbol
            const inputAmount = trade.inputAmount.toSignificant(3)
            const outputAmount = trade.outputAmount.toSignificant(3)

            const base = `Swap ${inputAmount} ${inputSymbol} for ${outputAmount} ${outputSymbol}`
            const withRecipient =
              recipient === account
                ? base
                : `${base} to ${recipientAddressOrName && isAddress(recipientAddressOrName)
                  ? shortenAddress(recipientAddressOrName)
                  : recipientAddressOrName
                }`

            addTransaction(response, {
              summary: withRecipient,
            })

            return response.hash
          })
          .catch((error: any) => {
            // if the user rejected the tx, pass this along
            if (error?.code === 4001) {
              throw new Error('Transaction rejected.')
            } else {
              // otherwise, the error was unexpected and we need to convey that
              console.error(`Swap failed`, error, methodName, args, value)
              throw new Error(`Swap failed: ${error.message}`)
            }
          })
      },
      error: null,
    }
  }, [
    trade,
    library,
    account,
    chainId,
    recipient,
    routerContract,
    recipientAddressOrName,
    swapCalls,
    addTransaction,
    gasPrice,
    autonomyPrepay,
  ])
}
