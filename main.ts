// Deep-dip reversion bot for cbBTC/USDC, agent-fun/bars-replay/v1 (run: node main.ts).
//
// Each minute's batch carries one bar of CBBTC. The bot stays in cash until the close falls
// well below its slow EMA (a sharp flush), buys with all its cash, and sells when the price has
// come back above the EMA, on a hard stop, or after a maximum hold. It trades rarely on purpose:
// a full round trip costs about 26 bps in fees, slippage and impact, so only big stretches pay.
// A tiny probe buy and sell near the start makes sure the window has at least one trade.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';
import { Strategy, type Params } from './strategy.ts';

const SYMBOL = 'CBBTC';

const PARAMS: Params = {
  mode: 'dip',
  emaSpan: 180,
  entryBps: 130,
  exitBps: 30,
  stopBps: 200,
  trailBps: 0,
  takeBps: 0,
  maxHold: 480,
  cooldown: 30,
  lookback: 60,
  warmup: 60,
  size: 1,
};

/** Probe: buy this many quote units (1.234567 USDC) on batch PROBE_BUY, sell it all on PROBE_SELL. */
const PROBE_QUOTE = 1_234_567n;
const PROBE_BUY = 7;
const PROBE_SELL = 9;
/** A position worth less than this is the probe, not a trade of the rule. */
const DUST_QUOTE = 10_000_000n;
const BUY_SLIPPAGE_BPS = 120;
const SELL_SLIPPAGE_BPS = 400;

const strategy = new Strategy(PARAMS);
let batches = 0;
/** Set once an exit is decided, cleared when the position is gone. */
let exiting = false;

await runBars({
  onBatch(state, batch) {
    batches++;
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    const held = state.positions.get(SYMBOL);
    const heldValue = held === undefined ? 0n : state.value(SYMBOL, held.qty);
    const orders: (BuyInput | SellInput)[] = [];

    if (batches === PROBE_BUY && held === undefined && bar !== undefined) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: PROBE_QUOTE, max_slippage_bps: 500, client_id: 'probe-buy' }];
    }
    if (batches >= PROBE_SELL && held !== undefined && heldValue < DUST_QUOTE) {
      // The probe (or any dust): sell all of it; a whole-position sell is allowed below the minimum.
      orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: 1000, client_id: `probe-sell-${batches}` });
      return orders;
    }
    // A minute with no bar: nothing new to decide on.
    if (bar === undefined) return orders;

    const holding = held !== undefined && heldValue >= DUST_QUOTE;
    if (!holding) exiting = false;
    const d = strategy.onClose(Number(bar.c), holding);

    // An exit the market refused (slippage cap) is sent again every bar until it fills,
    // even if the reason for it no longer holds at this close.
    if (holding && (exiting || d?.kind === 'sell')) {
      exiting = true;
      orders.push({ side: 'sell', symbol: SYMBOL, qty: held!.qty, max_slippage_bps: SELL_SLIPPAGE_BPS, client_id: `x-${d?.kind === 'sell' ? d.why : 'retry'}-${batches}` });
      return orders;
    }
    if (d === null) return orders;

    if (d.kind === 'buy' && !holding && held === undefined) {
      const room = state.weightRoom(SYMBOL);
      let spend = (state.cash * BigInt(Math.round(d.size * 10_000))) / 10_000n;
      if (spend > room) spend = room;
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: BUY_SLIPPAGE_BPS, client_id: `dip-${batches}` });
      }
    }
    return orders;
  },
});
