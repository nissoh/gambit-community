import { Behavior, combineArray, combineObject, O, replayLatest } from '@aelea/core'
import { $node, $text, component, nodeEvent, style, styleBehavior, StyleCSS } from "@aelea/dom"
import { Route } from '@aelea/router'
import { $card, $column, $row, layoutSheet, screenUtils, state } from '@aelea/ui-components'
import { pallete } from '@aelea/ui-components-theme'
import { BaseProvider } from '@ethersproject/providers'
import { constant, filter, map, merge, multicast, now, periodic, skipRepeats, snapshot, startWith, switchLatest } from '@most/core'
import { Stream } from '@most/types'
import { IAggregatedAccountSummary, IAggregatedOpenPositionSummary, IAggregatedSettledTradeSummary, IAggregatedTradeSummary, IClaim, ILeaderboardRequest, intervalInMsMap, IPagableResponse, IPageable, IPositionDelta, ISortable, parseFixed, TradeType } from 'gambit-middleware'
import { $Table2, ISortBy, TablePageResponse } from "../common/$Table2"
import { $AccountPreview } from '../components/$AccountProfile'
import { $AnchorLink, $Link } from "../components/$Link"
import { $anchor } from '../elements/$common'
import { $Entry, $LivePnl, $SummaryProfitLoss, $Risk, $RiskLiquidator, filterByIndexToken, priceChange, winLossTableColumn } from "./common"


enum CompetitionDisplay {
  CONUTER,
  COMPETITION_DETAILS,
  COMPETITION_RESULTS,
}



export interface ILeaderboard<T extends BaseProvider> {
  parentRoute: Route
  provider?: Stream<T>
  claimMap: Stream<Map<string, IClaim>>

  requestLeaderboardTopList: Stream<IPagableResponse<IAggregatedAccountSummary>>
  openAggregatedTrades: Stream<IPagableResponse<IAggregatedOpenPositionSummary>>

  parentStore: <T, TK extends string = string>(key: TK, intitialState: T) => state.BrowserStore<T, TK>;
}



export const $Leaderboard = <T extends BaseProvider>(config: ILeaderboard<T>) => component((
  [topPnlTimeframeChange, topPnlTimeframeChangeTether]: Behavior<any, ILeaderboardRequest['timeInterval']>,

  [routeChange, routeChangeTether]: Behavior<string, string>,
  [tableTopPnlRequest, tableTopPnlRequestTether]: Behavior<number, number>,
  [openPositionsRequest, openPositionsRequestTether]: Behavior<number, number>,
  [tableTopSettledsortByChange, tableTopSettledsortByChangeTether]: Behavior<ISortBy<IAggregatedAccountSummary>, ISortBy<IAggregatedAccountSummary>>,
  [tableTopOpenSortByChange, tableTopOpenSortByChangeTether]: Behavior<ISortBy<IAggregatedOpenPositionSummary & IPositionDelta>, ISortBy<IAggregatedOpenPositionSummary & IPositionDelta>>,

) => {

  const $header = $text(style({ fontSize: '1.15em', letterSpacing: '4px' }))



  const timeFrameStore = config.parentStore<ILeaderboardRequest['timeInterval']>('timeframe', intervalInMsMap.HR24)
  const tableTopSettledSortByStore = config.parentStore<ISortBy<IAggregatedAccountSummary>>('tableTopSettledSortByStore', { name: 'realisedPnl', direction: 'asc' })
  const tableTopOpenSortByStore = config.parentStore<ISortBy<IAggregatedOpenPositionSummary & IPositionDelta>>('tableTopOpenSortByStore', { name: 'delta', direction: 'asc' })
  
  const tableTopSettledSortBy = replayLatest(multicast(startWith(tableTopSettledSortByStore.state, tableTopSettledSortByStore.store(tableTopSettledsortByChange, map(x => x)))))
  const tableTopOpenSortBy = startWith(tableTopOpenSortByStore.state, tableTopOpenSortByStore.store(tableTopOpenSortByChange, map(x => x)))
  const filterByTimeFrameState = replayLatest(multicast(startWith(timeFrameStore.state, timeFrameStore.store(topPnlTimeframeChange, map(x => x)))))

  const tableRequestState = snapshot(({ filterByTimeFrameState: timeInterval, tableTopSettledSortBy: sortBy }, page): ILeaderboardRequest => {
    const name = sortBy.name

    return {
      timeInterval,
      offset: page * 20,
      pageSize: 20,
      sortBy: name,
      sortDirection: sortBy.direction
    }
  }, combineObject({ tableTopSettledSortBy, filterByTimeFrameState }), tableTopPnlRequest)

  const tableTopOpenState = combineArray((page, sortBy): IPageable & ISortable<any> => {
    return { offset: page * 20, pageSize: 20, sortBy: sortBy.name, sortDirection: sortBy.direction }
  }, openPositionsRequest, tableTopOpenSortBy)


  const openPositions: Stream<TablePageResponse<IAggregatedOpenPositionSummary>> = map((res) => {
    return {
      data: res.page
      // .filter(a => (
      //   a.account == '0x04d52e150e49c1bbc9ddde258060a3bf28d9fd70'
      //   // || a.account == '0x04d52e150e49c1bbc9ddde258060a3bf28d9fd70'.toLocaleLowerCase()
      // ))
      ,
      pageSize: res.pageSize,
      offset: res.offset,
      // .map(toAggregatedOpenTradeSummary)
        
    }
  }, config.openAggregatedTrades)


  const activeTimeframe: StyleCSS = { color: pallete.primary, pointerEvents: 'none' }


  const accountTableColumn = {
    $head: $text('Account'),
    columnOp: style({ minWidth: '120px' }),
    $body: map(({ account }: IAggregatedTradeSummary) => {

      return switchLatest(map(map => {
        return $AccountPreview({ address: account, parentRoute: config.parentRoute, claim: map.get(account.toLowerCase()) })({
          profileClick: routeChangeTether()
        })
      }, config.claimMap))
    })
  }



  // Set the date we're counting down to
  const competitionStartDate = Date.UTC(2021, 10, 2, 13, 0, 0)
  const competitionEndDate = Date.UTC(2021, 10, 30, 13, 0, 0)

  const secondsCountdown = map(Date.now, periodic(1000))

  const competitionCountdown = map(now => {
    const distance = competitionStartDate - now

    const days = Math.floor(distance / (1000 * 60 * 60 * 24))
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((distance % (1000 * 60)) / 1000)
      
    return `${days ? days + "d " : ''} ${hours ? hours + "h " : '' } ${ minutes ? minutes + "m " : ''} ${seconds ? seconds + "s " : ''}`
  }, secondsCountdown)

  const $competitionTimer = $text(style({ fontWeight: 'bold' }))(competitionCountdown)

  // const competitionEntryDetails = '

 
  const competitionTypeChange = skipRepeats(map(now => {
    if (competitionStartDate > now) {
      return CompetitionDisplay.CONUTER
    }

    return now > competitionEndDate ? CompetitionDisplay.COMPETITION_RESULTS : CompetitionDisplay.COMPETITION_DETAILS
  }, secondsCountdown))

  const stateMap = {
    [CompetitionDisplay.CONUTER]: $row(layoutSheet.spacingSmall)(
      $text(style({}))(`Starting in ${new Date(Date.UTC(2021, 10, 3, 13, 0, 0)).toLocaleString()}... `),
      $competitionTimer
    ),
    [CompetitionDisplay.COMPETITION_DETAILS]: $row(layoutSheet.spacingSmall, style({ alignItems: 'center', placeContent: 'center' }))(
      $text(style({ color: pallete.indeterminate }))('Competiton is Live! '),
      $AnchorLink({
        anchorOp: style({ position: 'relative' }),
        $content: $text('Top Singles'),
        url: `/p/redvsgreen-nov2021-single-1`,
        route: config.parentRoute.create({ fragment: '2121212' })
      })({ click: routeChangeTether() }),
      $row(style({ color: pallete.foreground }))($text('|')),
      $AnchorLink({
        anchorOp: style({ position: 'relative' }),
        $content: $text('Top Cumulative'),
        url: `/p/redvsgreen-nov2021-cumulative-1`,
        route: config.parentRoute.create({ fragment: '2121212' })
      })({ click: routeChangeTether() }),
    ),
    [CompetitionDisplay.COMPETITION_RESULTS]: $text('RESULTS'),
  }

  const $details = switchLatest(map(state => stateMap[state], competitionTypeChange))

  return [

    $column(
      
      $column(layoutSheet.spacing, style({ alignItems: 'center', placeContent: 'center', marginBottom: '60px', }))(
        $text(style({ fontSize: '.85em' }))('November Competition Kickoff'),
        $row(layoutSheet.spacingSmall, style({ alignItems: 'baseline' }))(
          $text(style({ fontSize: '2.5em', fontWeight: 'bold', color:pallete.negative, textShadow: `1px 1px 50px ${pallete.negative}, 1px 1px 50px rgb(250 67 51 / 59%) ` }))('RED'),
          $text(style({  }))('vs.'),
          $text(style({ fontSize: '2.5em', fontWeight: 'bold', color:pallete.positive, textShadow: `1px 1px 50px ${pallete.positive}` }))('GREEN'),
        ),
        $details
      ),

      $node(style({ gap: '46px', display: 'flex', flexDirection: screenUtils.isMobileScreen ? 'column' : 'row' }))(

        $column(layoutSheet.spacing, style({ flex: 1, padding: '0 12px' }))(

          $row(style({ fontSize: '0.85em', justifyContent: 'space-between' }))(
            $row(layoutSheet.spacing)(
              $header(layoutSheet.flex)(`Top Settled`),
              // $header(layoutSheet.flex)(`Settled`),
              // $icon({ $content: $caretDown, viewBox: '0 0 32 32', width: '8px', svgOps: style({ marginTop: '4px' }) })
            ),

            $row(layoutSheet.spacing)(
              $text(style({ color: pallete.foreground }))('Time Frame:'),
              $anchor(
                styleBehavior(map(tf => tf === intervalInMsMap.HR24 ? activeTimeframe : null, filterByTimeFrameState)),
                topPnlTimeframeChangeTether(nodeEvent('click'), constant(intervalInMsMap.HR24))
              )(
                $text('24Hour')
              ),
              $anchor(
                styleBehavior(map(tf => tf === intervalInMsMap.DAY7 ? activeTimeframe : null, filterByTimeFrameState)),
                topPnlTimeframeChangeTether(nodeEvent('click'), constant(intervalInMsMap.DAY7))
              )(
                $text('7Day')
              ),
              $anchor(
                styleBehavior(map(tf => tf === intervalInMsMap.MONTH ? activeTimeframe : null, filterByTimeFrameState)),
                topPnlTimeframeChangeTether(nodeEvent('click'), constant(intervalInMsMap.MONTH))
              )(
                $text('1Month')
              )
            )
          ),
          $card(layoutSheet.spacingBig, style({ padding: screenUtils.isMobileScreen ? '16px 8px' : '20px', margin: '0 -12px' }))(
            $Table2<IAggregatedAccountSummary>({
              bodyContainerOp: layoutSheet.spacing,
              scrollConfig: {
                containerOps: O(layoutSheet.spacingBig)
              },
              sortChange: now(tableTopSettledSortByStore.state),
              filterChange: merge(topPnlTimeframeChange, tableTopSettledsortByChange),
              dataSource: map((res) => {
                return {
                  data: res.page,
                  pageSize: res.pageSize,
                  offset: res.offset,
                }
              }, config.requestLeaderboardTopList),
              // bodyRowOp: O(layoutSheet.spacing),
              columns: [
                accountTableColumn,
                winLossTableColumn,
                {
                  $head: $text('Risk-$'),
                  sortBy: 'size',
                  columnOp: style({ placeContent: 'center' }),
                  $body: map((pos: IAggregatedTradeSummary) => {
                    return $Risk(pos)({})
                  })
                },
                // {
                //   $head: $text('Size $'),
                //   columnOp: O(layoutSheet.spacingTiny, style({ textAlign: 'left', maxWidth: '150px', placeContent: 'flex-start' })),
                //   $body: map((pos: IAggregatedTradeSummary) => {
                //     return $text(style({ fontSize: '.65em' }))(formatReadableUSD(pos.size))
                //   })
                // },
                {
                  $head: $text('PnL-$'),
                  sortBy: 'realisedPnl',
                  columnOp: style({ flex: 1.5, placeContent: 'flex-end', maxWidth: '160px' }),
                  $body: map((pos: IAggregatedSettledTradeSummary) => $row($SummaryProfitLoss(pos)))
                },
              ],
            })({ scrollIndex: tableTopPnlRequestTether(), sortBy: tableTopSettledsortByChangeTether() })
          ),
        ),
        $column(layoutSheet.spacing, style({ flex: 1, padding: '0 12px' }))(
          $row(layoutSheet.spacing, style({ fontSize: '0.85em' }))(
            $row(layoutSheet.spacing)(
              $header(layoutSheet.flex)(`Top Open`),
              // $header(layoutSheet.flex)(`Settled`),
              // $icon({ $content: $caretDown, viewBox: '0 0 32 32', width: '8px', svgOps: style({ marginTop: '4px' }) })
            ),
          ),
          $card(layoutSheet.spacingBig, style({ padding: screenUtils.isMobileScreen ? '16px 8px' : '20px', margin: '0 -12px' }))(
            $Table2<IAggregatedOpenPositionSummary>({
              bodyContainerOp: layoutSheet.spacing,
              scrollConfig: {
                containerOps: O(layoutSheet.spacingBig)
              },
              sortChange: now(tableTopOpenSortByStore.state),
              dataSource: openPositions,
              columns: [
                accountTableColumn,
                {
                  $head: $text('Entry'),
                  columnOp: O(style({ maxWidth: '58px', flexDirection: 'column' }), layoutSheet.spacingTiny),
                  $body: map((pos: IAggregatedOpenPositionSummary) =>
                    $Link({
                      anchorOp: style({ position: 'relative' }),
                      $content: style({ pointerEvents: 'none' }, $Entry(pos)),
                      url: `/p/account/${pos.trade.initialPosition.indexToken}-${TradeType.OPEN}-${pos.trade.initialPosition.indexedAt}-${Math.floor(Date.now() / 1000)}/${pos.trade.id}`,
                      route: config.parentRoute.create({ fragment: '2121212' })
                    })({ click: routeChangeTether() })
                  )
                },
                {
                  $head: $text('Risk-$'),
                  sortBy: 'size',
                  columnOp: style({ flex: 1.3, alignItems: 'center', placeContent: 'center', minWidth: '80px' }),
                  $body: map((pos: IAggregatedOpenPositionSummary) => {
                    const positionMarkPrice = map(priceUsd => parseFixed(priceUsd.p, 30), filterByIndexToken(pos.indexToken)(priceChange))
                  
                    return $RiskLiquidator(pos, positionMarkPrice)({})
                  })
                },
                {
                  $head: $text('PnL-$'),
                  // @ts-ignore
                  sortBy: 'delta',
                  columnOp: style({ flex: 2, placeContent: 'flex-end', maxWidth: '110px' }),
                  $body: map((pos) => $LivePnl(pos)({}))
                },
              ],
            })({ scrollIndex: openPositionsRequestTether(), sortBy: tableTopOpenSortByChangeTether() }),
            // sideEffect, avoid reconnecting websocket every sort change
            
            filter(x => false, priceChange) as Stream<never>,
          ),
        )
      ),
    ),


    {
      requestLeaderboardTopList: tableRequestState,
      requestOpenAggregatedTrades: tableTopOpenState,
      routeChange
    }
  ]
})


