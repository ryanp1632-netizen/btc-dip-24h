// The trading rule, kept apart from the protocol so tools/sim.ts can replay it on the dev bars.
// One asset, long only, at most one position. Decisions are made on each bar's close and fill at
// the next bar's open (the harness's one-bar latency). Every value here is float64 built from the
// closes with + - * / only, so the same bars always give the same decisions.

export interface Params {
  /** 'dip': buy a stretch below the EMA, sell when price comes back. 'trend': buy a breakout, ride it with a trailing stop. */
  mode: 'dip' | 'trend';
  /** EMA span in bars (the "fair value" the dip is measured from). */
  emaSpan: number;
  /** dip: enter when close <= EMA * (1 - entryBps/1e4). trend: enter when close >= highest close of lookback * (1 + entryBps/1e4). */
  entryBps: number;
  /** dip: exit when close >= EMA * (1 + exitBps/1e4) (negative = exit before the full reversion). */
  exitBps: number;
  /** Hard stop: exit when close <= entry price * (1 - stopBps/1e4). */
  stopBps: number;
  /** Trailing stop from the highest close since entry (0 = off). */
  trailBps: number;
  /** Take profit over the entry price (0 = off). */
  takeBps: number;
  /** Leave after this many bars held (0 = never). */
  maxHold: number;
  /** Bars to wait after an exit before a new entry. */
  cooldown: number;
  /** trend: breakout lookback in bars. */
  lookback: number;
  /** Bars of history needed before the first entry. */
  warmup: number;
  /** Share of equity to put in on an entry, in [0, 1]. */
  size: number;
}

export const DEFAULTS: Params = {
  mode: 'dip',
  emaSpan: 120,
  entryBps: 60,
  exitBps: 0,
  stopBps: 100,
  trailBps: 0,
  takeBps: 0,
  maxHold: 240,
  cooldown: 30,
  lookback: 60,
  warmup: 60,
  size: 1,
};

export type Decision = { kind: 'buy'; size: number } | { kind: 'sell'; why: string } | null;

export class Strategy {
  readonly p: Params;
  ema: number | null = null;
  closes: number[] = [];
  holding = false;
  entry = 0;
  peak = 0;
  held = 0;
  sinceExit = 1e9;

  constructor(p: Params) {
    this.p = p;
  }

  /** Feed one close; `holding` must already reflect the account. Returns what to do at the next open. */
  onClose(close: number, holding: boolean): Decision {
    const p = this.p;
    if (holding && !this.holding) {
      // A buy filled: start tracking it from this close (the fill price is close to it).
      this.entry = close;
      this.peak = close;
      this.held = 0;
    }
    if (!holding && this.holding) this.sinceExit = 0;
    this.holding = holding;

    const prevHigh = this.closes.length >= p.lookback ? Math.max(...this.closes.slice(-p.lookback)) : Infinity;
    this.closes.push(close);
    if (this.closes.length > 2000) this.closes.splice(0, this.closes.length - 2000);
    this.ema = this.ema === null ? close : this.ema + (2 / (p.emaSpan + 1)) * (close - this.ema);
    this.sinceExit++;

    if (holding) {
      this.held++;
      if (close > this.peak) this.peak = close;
      if (close <= this.entry * (1 - p.stopBps / 1e4)) return { kind: 'sell', why: 'stop' };
      if (p.trailBps > 0 && close <= this.peak * (1 - p.trailBps / 1e4)) return { kind: 'sell', why: 'trail' };
      if (p.takeBps > 0 && close >= this.entry * (1 + p.takeBps / 1e4)) return { kind: 'sell', why: 'take' };
      if (p.mode === 'dip' && close >= this.ema * (1 + p.exitBps / 1e4)) return { kind: 'sell', why: 'revert' };
      if (p.maxHold > 0 && this.held >= p.maxHold) return { kind: 'sell', why: 'time' };
      return null;
    }

    if (this.closes.length < p.warmup || this.sinceExit <= p.cooldown) return null;
    if (p.mode === 'dip' && close <= this.ema * (1 - p.entryBps / 1e4)) return { kind: 'buy', size: p.size };
    if (p.mode === 'trend' && close >= prevHigh * (1 + p.entryBps / 1e4) && close > this.ema) return { kind: 'buy', size: p.size };
    return null;
  }
}
