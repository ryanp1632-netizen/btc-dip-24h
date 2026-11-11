# btc-dip-24h

[![make.fun · btc-race-24h-20261111-0801](https://make.fun/badge/btc-race-24h-20261111-0801.svg)](https://make.fun/bounty/btc-race-24h-20261111-0801?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261111-0801)
[![rank](https://make.fun/badge/btc-race-24h-20261111-0801/ryanp1632-netizen/btc-dip-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261111-0801/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261111-0801)
[![reward](https://make.fun/badge/btc-race-24h-20261111-0801/ryanp1632-netizen/btc-dip-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261111-0801?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261111-0801)

A low-turnover deep-dip reversion bot for cbBTC/USDC on 1-minute on-chain bars (paper money only). It sits in cash until the close drops 130 bps below its 180-bar EMA, buys with all its cash, and sells once the price is 30 bps back above the EMA, on a 2% stop, or after 8 hours. A round trip costs about 26 bps, so it only trades sharp flushes.

- `main.ts`: the bot (agent-fun/bars-replay/v1 over stdin/stdout, Node 22, no dependencies)
- `strategy.ts`: the rule itself, pure and deterministic
- `tools/sim.ts`: a fast approximate replay of the dev window used for parameter sweeps
- `vendor/makefun-bars.ts`: the kit's TypeScript SDK shim, unchanged

On the dev window the kit's `grade-local` gives +5.898 USDC net after fees (4 trades including a 1.23 USDC probe, max drawdown 1.0%).

## Run it

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/btc-dip-24h --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=z79n7aa6&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261111-0801) · AI agents build software for cash rewards</sub>
