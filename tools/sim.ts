// A fast, approximate replay of the dev window for parameter sweeps. Fills follow RULES.txt:
// an order decided on bar i fills at bar i+1's open, 4 bps fee, 2 bps slippage and constant-product
// impact a/D against the fill bar's open depth; whatever is held at the end is sold at the last close.
// The official grade (the kit's grade-local) is the judge; this only ranks parameter sets quickly.
//
//   node tools/sim.ts <bars.ndjson.gz> [sweep]

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DEFAULTS, Strategy, type Params } from '../strategy.ts';

interface Bar { t: number; o: number; c: number; od: number; cd: number }

export function load(path: string): Bar[] {
  const text = gunzipSync(readFileSync(path)).toString('utf8').trim();
  return text.split('\n').map((l) => {
    const b = JSON.parse(l);
    return { t: b.t, o: Number(b.o) / 1e5, c: Number(b.c) / 1e5, od: Number(b.o_depth[0]) / 1e6, cd: Number(b.c_depth[0]) / 1e6 };
  });
}

export interface Result { pnl: number; trades: number; maxDd: number; exposure: number; log: string[] }

const FEE = 4e-4;
const SLIP = 2e-4;

export function simulate(bars: Bar[], p: Params): Result {
  const s = new Strategy(p);
  let cash = 1000;
  let qty = 0;
  let trades = 0;
  let peak = 1000;
  let maxDd = 0;
  let inBars = 0;
  const log: string[] = [];
  let pending: { kind: 'buy'; size: number } | { kind: 'sell' } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (pending !== null) {
      if (pending.kind === 'buy' && qty === 0) {
        const spend = cash * pending.size;
        const fee = spend * FEE;
        const a = spend - fee;
        const px = b.o * (1 + SLIP) * (1 + a / b.od);
        qty = a / px;
        cash -= spend;
        trades++;
        log.push(`${i} buy ${px.toFixed(2)}`);
      } else if (pending.kind === 'sell' && qty > 0) {
        const a = qty * b.o;
        const px = (b.o * (1 - SLIP)) / (1 + a / b.od);
        const gross = qty * px;
        cash += gross * (1 - FEE);
        qty = 0;
        trades++;
        log.push(`${i} sell ${px.toFixed(2)} cash ${cash.toFixed(2)}`);
      }
      pending = null;
    }
    const eq = cash + qty * b.c;
    if (qty > 0) inBars++;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, (peak - eq) / peak);
    if (i === bars.length - 1) break;
    const d = s.onClose(b.c, qty > 0);
    if (d !== null) pending = d.kind === 'buy' ? { kind: 'buy', size: d.size } : { kind: 'sell' };
  }
  if (qty > 0) {
    const b = bars[bars.length - 1]!;
    const a = qty * b.c;
    const px = (b.c * (1 - SLIP)) / (1 + a / b.cd);
    cash += qty * px * (1 - FEE);
  }
  return { pnl: cash - 1000, trades, maxDd, exposure: inBars / bars.length, log };
}

function* grid(): Generator<Params> {
  for (const emaSpan of [30, 60, 120, 240])
    for (const entryBps of [30, 45, 60, 80, 100, 130])
      for (const exitBps of [-20, 0, 20])
        for (const stopBps of [60, 100, 150, 250])
          for (const maxHold of [60, 240, 0])
            yield { ...DEFAULTS, mode: 'dip', emaSpan, entryBps, exitBps, stopBps, maxHold, cooldown: 30, warmup: 60 };
  for (const emaSpan of [60, 240, 480])
    for (const lookback of [30, 60, 120, 240])
      for (const entryBps of [0, 10, 25])
        for (const trailBps of [40, 70, 100, 150])
          for (const stopBps of [60, 100, 200])
            yield { ...DEFAULTS, mode: 'trend', emaSpan, lookback, entryBps, trailBps, stopBps, exitBps: 0, maxHold: 0, cooldown: 30, warmup: 60 };
}

if (import.meta.main) {
  const bars = load(process.argv[2]!);
  if (process.argv[3] === 'sweep') {
    const rows: [number, Params, Result][] = [];
    for (const p of grid()) {
      const r = simulate(bars, p);
      rows.push([r.pnl, p, r]);
    }
    rows.sort((a, b) => b[0] - a[0]);
    const prof = rows.filter((r) => r[0] > 0).length;
    console.log(`${rows.length} sets, ${prof} profitable`);
    for (const [pnl, p, r] of rows.slice(0, 40)) {
      console.log(pnl.toFixed(2).padStart(7), String(r.trades).padStart(3), (r.maxDd * 100).toFixed(2), (r.exposure * 100).toFixed(0).padStart(3) + '%',
        p.mode, `ema${p.emaSpan} lb${p.lookback} in${p.entryBps} out${p.exitBps} stop${p.stopBps} trail${p.trailBps} hold${p.maxHold}`);
    }
  } else {
    const r = simulate(bars, DEFAULTS);
    console.log(r.pnl.toFixed(3), r.trades, r.log.join('\n'));
  }
}
