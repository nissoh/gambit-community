import { O } from "@aelea/core"
import { awaitPromises, map } from "@most/core"
import { fromJson, pagingQuery, groupByMap, groupByMapMany, ITrade, TradeStatus, IChainParamApi, intervalInMsMap, IPagePositionParamApi, ITimerangeParamApi, unixTimestampNow, IPricefeed, calculatePositionDelta, isTradeOpen, isTradeSettled, BASIS_POINTS_DIVISOR, isTradeLiquidated } from "@gambitdao/gmx-middleware"
import { IAccountLadderSummary } from "common"
import { EM } from '../server'
import { Claim } from "./dto"
import { cacheMap } from "../utils"
import { competitionAccountListDoc } from "./queries"
import { fetchHistoricTrades, graphMap } from "./api"
import { gql, TypedDocumentNode } from "@urql/core"


const bigNumberForPriority = 10n ** 50n

const createCache = cacheMap({})

export const competitionCumulativePnl = O(
  map((queryParams: IChainParamApi & IPagePositionParamApi & ITimerangeParamApi) => {

    const dateNow = unixTimestampNow()
    const isLive = queryParams.to > dateNow
    const cacheDuration = isLive ? intervalInMsMap.MIN5 : intervalInMsMap.YEAR

    const query = createCache('competitionCumulativePnl' + queryParams.from + queryParams.chain, cacheDuration, async () => {


      const to = Math.min(dateNow, queryParams.to)
      const timeSlot = Math.floor(to / intervalInMsMap.MIN5)
      const timestamp = timeSlot * intervalInMsMap.MIN5 - intervalInMsMap.MIN5

      const from = queryParams.from

      const competitionAccountListQuery = fetchHistoricTrades(competitionAccountListDoc, { from, to, offset: 0, pageSize: 1000 }, queryParams.chain, 0, (res) => res.trades)

      const claimListQuery = EM.find(Claim, {})

      const competitionPricefeedMap: TypedDocumentNode<{ pricefeeds: IPricefeed[] }, {}> = gql`
      {
        pricefeeds(where: { timestamp: ${timestamp.toString()} }) {
          id
          timestamp
          tokenAddress
          c
          interval
        }
      }
    `

      const priceMapQuery = graphMap[queryParams.chain](competitionPricefeedMap, {}).then(res => {
        const list = groupByMap(res.pricefeeds, item => item.tokenAddress)
        return list
      })

      const historicTradeList = await competitionAccountListQuery
      const priceMap = await priceMapQuery
      const claimList = await claimListQuery

      const tradeList: ITrade[] = historicTradeList.map(fromJson.toTradeJson)
      // .filter(x => x.account === '0xd92f6d0c7c463bd2ec59519aeb59766ca4e56589')
      const claimMap = groupByMap(claimList, item => item.account.toLowerCase())

      const formattedList = toAccountCompetitionSummary(tradeList, priceMap, to)
        .sort((a, b) => {
          const aN = claimMap[a.account] ? a.realisedPnl : a.realisedPnl - bigNumberForPriority
          const bN = claimMap[b.account] ? b.realisedPnl : b.realisedPnl - bigNumberForPriority

          return Number(bN - aN)
        })

      return formattedList
    })

    return pagingQuery(queryParams, query)
  }),
  awaitPromises
)

export interface ILadderAccount {
  winTradeCount: number
  settledTradeCount: number
  openTradeCount: number

  size: number
}


function getChangePercentage(isLong: boolean, price: bigint, markPrice: bigint) {
  const priceDelta = isLong ? markPrice - price : price - markPrice

  return priceDelta * BASIS_POINTS_DIVISOR / price
}

export function toAccountCompetitionSummary(list: ITrade[], priceMap: { [k: string]: IPricefeed }, endDate: number): IAccountLadderSummary[] {
  const tradeListMap = groupByMapMany(list, a => a.account)
  const tradeListEntries = Object.entries(tradeListMap)

  return tradeListEntries.reduce((seed, [account, tradeList]) => {

    const seedAccountSummary: IAccountLadderSummary = {
      claim: null,
      account,

      collateral: 0n,
      size: 0n,

      fee: 0n,
      realisedPnl: 0n,

      collateralDelta: 0n,
      sizeDelta: 0n,
      realisedPnlPercentage: 0n,
      performancePercentage: 0n,
      roi: 0n,
      openPnl: 0n,
      pnl: 0n,

      usedCollateralMap: {},
      maxCollateral: 0n,

      winTradeCount: 0,
      settledTradeCount: 0,
      openTradeCount: 0,
    }

    const sortedTradeList = tradeList.sort((a, b) => a.timestamp - b.timestamp)
    const summary = sortedTradeList.reduce((seed, next): IAccountLadderSummary => {

      const usedCollateralMap = {
        ...seed.usedCollateralMap,
        [next.key]: next.collateral
      }
      const currentUsedCollateral = Object.values(usedCollateralMap).reduce((s, n) => s + n, 0n)
      const usedCollateral = currentUsedCollateral > seed.maxCollateral ? currentUsedCollateral : seed.maxCollateral

      const indexTokenMarkPrice = BigInt(priceMap['_' + next.indexToken].c)
      const posDelta = calculatePositionDelta(indexTokenMarkPrice, next.averagePrice, next.isLong, next)
      const isSettled = isTradeSettled(next)


      const realisedPnl = seed.realisedPnl + next.realisedPnl
      const openPnl = seed.openPnl + posDelta.delta
      const pnl = openPnl + realisedPnl

      const usedMinProfit = usedCollateral - pnl
      const maxCollateral = usedMinProfit > seed.collateral ? usedMinProfit : usedCollateral
      const roi = pnl * BASIS_POINTS_DIVISOR / maxCollateral

      // const updateListFiltered = next.updateList.filter(t => t.timestamp <= endDate)
      // const adjustmentList = [...next.increaseList, ...next.decreaseList].sort((a, b) => a.timestamp - b.timestamp).filter(t => t.timestamp <= endDate)
      // const lastAdjustedPrice = isSettled
      //   ? isTradeLiquidated(next) ? next.liquidatedPosition.markPrice : next.decreaseList[0].price
      //   : adjustmentList[0].price
      // const lastRoi = getChangePercentage(next.isLong, lastAdjustedPrice, indexTokenMarkPrice)
      // const initialRoi = {
      //   roi: isSettled ? 0n : getChangePercentage(next.isLong, lastAdjustedPrice, indexTokenMarkPrice),
      //   prevAdjustedPrice: adjustmentList[0].price
      // }
      // const performancePercentage = adjustmentList.reduce((seed, nextUpdate, ifx, arr) => {
      //   const deltaRoi = getChangePercentage(next.isLong, seed.prevAdjustedPrice, nextUpdate.price)

      //   return {
      //     roi: seed.roi + deltaRoi,
      //     prevAdjustedPrice: nextUpdate.price
      //   }
      // }, initialRoi).roi

      return {
        account, realisedPnl, openPnl, pnl, usedCollateralMap, roi, maxCollateral,
        // openCollateral: 0n,

        collateral: seed.collateral + next.collateral,
        claim: null,
        fee: seed.fee + next.fee,
        collateralDelta: seed.collateralDelta + next.collateralDelta,

        realisedPnlPercentage: seed.realisedPnlPercentage + next.realisedPnlPercentage,
        size: seed.size + next.size,
        sizeDelta: seed.sizeDelta + next.sizeDelta,
        performancePercentage: 0n,
        // performancePercentage: seed.performancePercentage + performancePercentage,


        winTradeCount: seed.winTradeCount + (isSettled && next.realisedPnl > 0n ? 1 : 0),
        settledTradeCount: seed.settledTradeCount + (isSettled ? 1 : 0),
        openTradeCount: next.status === TradeStatus.OPEN ? seed.openTradeCount + 1 : seed.openTradeCount,
      }
    }, seedAccountSummary)

    seed.push(summary)

    return seed
  }, [] as IAccountLadderSummary[])
}

