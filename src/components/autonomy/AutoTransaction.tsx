import React, { useCallback } from 'react'
import { ethers } from 'ethers'
import { Token } from '@pancakeswap/sdk'
import { useRegistryContract } from '../../hooks/useContract'
import CurrencyLogo from '../Logo/CurrencyLogo'
import { Transaction } from './AutoHistoryStyles'

interface TxProps {
  tx: any
  tokenPair: {
    input: Token
    output: Token
  }
}

export default ({ tx, tokenPair }: TxProps) => {
  if (!tx || !tokenPair) return null

  const registryContract = useRegistryContract()

  const cancelTx = useCallback(async () => {
    if (!registryContract) return
    const transaction = await registryContract.cancelHashedReq(tx.id, [
      tx.requester,
      tx.target,
      tx.referer,
      tx.callData,
      tx.initEthSent,
      tx.ethForCall,
      tx.verifySender,
      tx.insertFeeAmount,
      tx.payWithAuto,
    ])
    await transaction.wait()
  }, [tx, registryContract])

  const inputAmount = ethers.utils.formatUnits(tx.inputAmount, tokenPair.input?.decimals)
  const outputAmount = ethers.utils.formatUnits(tx.outputAmount, tokenPair.output?.decimals)

  return (
    <Transaction>
      <div className="txContainer">
        <small style={{ fontSize: '12px', fontWeight: 'bold', textDecoration: 'underline' }}>{tx.typeof}</small>
        <div style={{ marginLeft: '12px', marginTop: '2px' }} className="txInfo">
          <p style={{ marginTop: '2px', fontWeight: 'bold' }}>
            Sell
            <span className="token">
              <CurrencyLogo currency={tokenPair.input} size="14px" style={{ marginRight: '5px' }} />
              {inputAmount} <div style={{ fontWeight: 'bold', marginLeft: '2px' }}>{tokenPair.input?.symbol}</div>
            </span>
          </p>
          <p style={{ fontWeight: 'bold' }}>
            Buy
            <span className="token">
              <CurrencyLogo currency={tokenPair.output} size="14px" style={{ marginRight: '5px' }} />
              {outputAmount} <div style={{ fontWeight: 'bold', marginLeft: '2px' }}> {tokenPair.output?.symbol}</div>
            </span>
          </p>
        </div>
        <div className="txTime" style={{ marginLeft: '10px' }}>
          <small>
            <i>Placed On: {tx.time}</i>
          </small>
        </div>
      </div>
      <div className="action">
        {tx.status === 'open' && (
          <button type="button" onClick={cancelTx}>
            Cancel
          </button>
        )}
      </div>
    </Transaction>
  )
}
