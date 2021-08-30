import { useEffect, useCallback, useMemo, useState } from 'react'
import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import gql from 'graphql-tag'
import { ChainId } from '@pancakeswap/sdk'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { utils } from 'ethers'
import { ROUTER_ADDRESS } from 'config/constants'
import { useRegistryContract } from 'hooks/useContract'
import { MIDROUTER_CONTRACT_ADDRESS } from 'config/constants/autonomy'

const autonomyHistory = new ApolloClient({
  link: createHttpLink({
    uri: 'https://api.studio.thegraph.com/query/2719/autonomy-subgraph-bsc-mainnet-2/v.0.0.1',
  }),
  cache: new InMemoryCache(),
})
const TRANSACTION_HISTORY = gql`
  query newRequests($account: String, $contract: String) {
    newRequests(where: { requester: $account, target: $contract }) {
      id
      timeStamp
      requester
      target
      referer
      callData
      initEthSent
      ethForCall
      verifySender
      payWithAuto
    }
  }
`
const CANCELLATION_HISTORY = gql`
  query cancelledRequests($account: String, $contract: String) {
    cancelledRequests(where: { requester: $account, target: $contract }) {
      id
      timeStamp
      requester
      target
      wasExecuted
    }
  }
`

async function getTransactionHistory(account: string | null | undefined) {
  if (!account) return []

  const graphServer = autonomyHistory
  const result = await graphServer.query({
    query: TRANSACTION_HISTORY,
    variables: {
      account,
      contract: MIDROUTER_CONTRACT_ADDRESS[ChainId.MAINNET],
    },
    fetchPolicy: 'no-cache',
  })
  return result.data.newRequests
}

async function getCancellationHistory(account: string | null | undefined) {
  if (!account) return []

  const graphServer = autonomyHistory
  const result = await graphServer.query({
    query: CANCELLATION_HISTORY,
    variables: {
      account,
      contract: MIDROUTER_CONTRACT_ADDRESS[ChainId.MAINNET],
    },
    fetchPolicy: 'no-cache',
  })

  return result.data.cancelledRequests
}

function methodSelector(orderData: any) {
  const sliced = orderData.slice(0, 10)
  if (sliced === '0xfa089c19') {
    return 'Limit -> Tokens for Matic'
  }
  if (sliced === '0xbc63cf67') {
    return 'Limit -> Matic for Tokens'
  }
  if (sliced === '0x9078cf66') {
    return 'Limit -> Tokens for Tokens'
  }
  if (sliced === '0x503bd854') {
    return 'Stop -> Tokens for Tokens'
  }
  if (sliced === '0xe2c691a8') {
    return 'Stop -> Matic for Tokens'
  }
  if (sliced === '0x4632bf0d') {
    return 'Stop -> Tokens for Matic'
  }
  return 'Undefined Method'
}

export default function useTransactionHistory() {
  const [transactions, setTransactions] = useState<any>([{}])
  const [orders, setOrders] = useState<Array<any>>([])
  const [cancels, setCancels] = useState<Array<any>>([])

  const { account, chainId } = useActiveWeb3React()

  // Returns a copy of orders but it adds the hashed parameter
  const aggregateHash = useMemo(() => JSON.parse(JSON.stringify(orders)), [orders])

  const canCancel = useCallback(
    (orderId: any) => {
      const cancelArr: any = []
      const executedArr: any = []
      cancels.forEach((cancel: any) => {
        if (!cancel.wasExecuted) {
          cancelArr.push(cancel.id)
        } else {
          executedArr.push(cancel.id)
        }
      })

      if (cancelArr.includes(orderId)) {
        return 'cancelled'
      }
      if (executedArr.includes(orderId)) {
        return 'executed'
      }
      return 'open'
    },
    [cancels],
  )

  const parseOrders = useCallback(
    (allOrders: any[]) => {
      return allOrders
        .map((order: any) => ({
          method: methodSelector(order.callData),
          callData: order.callData,
          time: timeConverter(order.timeStamp),
          id: order.id,
          inputToken: findInputToken(order.callData),
          outputToken: findOutPutToken(order.callData),
          inputAmount: findInputAmount(order.callData, order.ethForCall),
          outputAmount: findOutputAmount(order.callData),
          requester: order.requester,
          target: order.target,
          referer: order.referer,
          initEthSent: order.initEthSent,
          ethForCall: order.ethForCall,
          verifySender: order.verifySender,
          payWithAuto: order.payWithAuto,
          typeof: typeSelector(order.callData),
          status: canCancel(order.id),
        }))
        .filter((order: any) => order.callData.includes(ROUTER_ADDRESS.toLowerCase().substr(2)))
    },
    [canCancel],
  )

  useEffect(() => {
    async function init() {
      const [orders1, cancellations] = await Promise.all([
        getTransactionHistory(account),
        await getCancellationHistory(account),
      ])
      setCancels(cancellations)
      setOrders(parseOrders(orders1))
      /*
			// const data = await getTransactionHistory(account)
			// setOrders(parseOrders(data))
			const orders = getTransactionHistory(account)
			const cancellations = getCancellationHistory(account)
			const res = [await orders, await cancellations];
			const ordersResolved = await orders;
			const cancellationsResolved = await cancellations;
			console.log("here cancellations")
			console.log(cancellations);
			setCancels(cancellationsResolved)
			setOrders(parseOrders(ordersResolved)) */
    }
    init()
  }, [account, setOrders, setCancels, parseOrders])

  useEffect(() => {
    const interval = setInterval(async () => {
      const [orders1, cancellations] = await Promise.all([
        getTransactionHistory(account),
        await getCancellationHistory(account),
      ])
      setCancels(cancellations)
      setOrders(parseOrders(orders1))
      /*
			const orders = getTransactionHistory(account)
			const cancellations = getCancellationHistory(account)
			const res = [await orders, await cancellations];
			const ordersResolved = await orders;
			const cancellationsResolved = await cancellations;
			console.log("here cancellations")
			console.log(cancellations);
			setCancels(cancellationsResolved)
			setOrders(parseOrders(ordersResolved))
			const data = await getTransactionHistory(account)
			setOrders(parseOrders(data))
			*/
    }, 100)

    return () => clearInterval(interval)
  }, [account, orders, cancels, setOrders, setCancels, parseOrders])

  useEffect(() => {
    async function init() {
      setTransactions(aggregateHash)
    }
    init()
  }, [orders, setTransactions, aggregateHash])

  useEffect(() => {
    const interval = setInterval(async () => {
      setTransactions(aggregateHash)
    }, 10000)

    return () => clearInterval(interval)
  }, [orders, setTransactions, aggregateHash])

  function typeSelector(orderData: any) {
    const sliced = orderData.slice(0, 10)
    if (sliced === '0xfa089c19') {
      return 'Limit'
    }
    if (sliced === '0xbc63cf67') {
      return 'Limit'
    }
    if (sliced === '0x9078cf66') {
      return 'Limit'
    }
    if (sliced === '0x503bd854') {
      return 'Stop'
    }
    if (sliced === '0xe2c691a8') {
      return 'Stop'
    }
    if (sliced === '0x4632bf0d') {
      return 'Stop'
    }
    return 'Undefined'
  }

  function findOutputAmount(callData: any) {
    const sliced = callData.slice(0, 10)
    const actualData = `0x${callData.slice(10, callData.length + 1)}`
    if (sliced === '0xbc63cf67') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'address[]', ' address', 'uint256'],
        actualData,
      )
      return decoded[1].toString()
    }
    if (sliced === '0xfa089c19') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[3].toString()
    }
    if (sliced === '0x9078cf66') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[3].toString()
    }
    if (sliced === '0x503bd854') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4].toString()
    }
    if (sliced === '0xe2c691a8') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[2].toString()
    }
    if (sliced === '0x4632bf0d') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4].toString()
    }
    return ''
  }

  function findInputAmount(callData: any, ethForCall: any) {
    const sliced = callData.slice(0, 10)
    const actualData = `0x${callData.slice(10, callData.length + 1)}`
    if (sliced === '0xbc63cf67') {
      return ethForCall
    }
    if (sliced === '0xfa089c19') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[2].toString()
    }
    if (sliced === '0x9078cf66') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[2].toString()
      // STOP LOSS TOKEN TO TOKEN
    }
    if (sliced === '0x503bd854') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[2].toString()
    }
    if (sliced === '0xe2c691a8') {
      return ethForCall
    }
    if (sliced === '0x4632bf0d') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[2].toString()
    }
    return ''
  }

  function findOutPutToken(callData: any) {
    const sliced = callData.slice(0, 10)
    const actualData = `0x${callData.slice(10, callData.length + 1)}`
    if (sliced === '0xbc63cf67') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'address[]', ' address', 'uint256'],
        actualData,
      )
      return decoded[2][decoded[2].length - 1]
    }
    if (sliced === '0xfa089c19') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4][decoded[4].length - 1]
    }
    if (sliced === '0x9078cf66') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4][decoded[4].length - 1]
    }
    if (sliced === '0x503bd854') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[5][decoded[5].length - 1]
    }
    if (sliced === '0xe2c691a8') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[3][decoded[3].length - 1]
    }
    if (sliced === '0x4632bf0d') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[5][decoded[5].length - 1]
    }
    return ''
  }

  function findInputToken(callData: any) {
    const sliced = callData.slice(0, 10)
    const actualData = `0x${callData.slice(10, callData.length + 1)}`
    if (sliced === '0xbc63cf67') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'address[]', ' address', 'uint256'],
        actualData,
      )
      return decoded[2][0]
    }
    if (sliced === '0xfa089c19') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4][0]
    }
    if (sliced === '0x9078cf66') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[4][0]
    }
    if (sliced === '0x503bd854') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[5][0]
    }
    if (sliced === '0xe2c691a8') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[3][0]
    }
    if (sliced === '0x4632bf0d') {
      const decoded = utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'address', 'uint256'],
        actualData,
      )
      return decoded[5][0]
    }
    return ''
  }

  function timeConverter(timestamp: any) {
    const a = new Date(timestamp * 1000)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const year = a.getFullYear()
    const month = months[a.getMonth()]
    const date = a.getDate()
    const hour = a.getHours()
    const min = a.getMinutes()
    const sec = a.getSeconds()
    const time = `${date} ${month} ${year} ${hour}:${min}:${sec}`
    return time
  }
  return [transactions, orders]
}
