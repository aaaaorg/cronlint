# cronlint — Cron Job Cost & Intelligence Auditor

## What it does
Analyzes cron job configurations and run history to classify each job by whether it actually needs an AI model, and recommends the cheapest sufficient approach:
1. **bash-replaceable** — Job does something a shell script could do (git push, file cleanup, health checks). Flag it.
2. **model-downgrade** — Job uses Opus/Sonnet but could use Haiku (simple summarization, formatting).
3. **frequency-excessive** — Job runs too often for what it does (watchdog every 15min on Sonnet = $1.79/day).
4. **right-sized** — Job needs the model it's using.

## How WE use it
- Run in `cron-health` heartbeat check or as standalone CLI
- Produces actionable recommendations with estimated savings
- Feeds into a weekly cost optimization report

## CLI Interface
```
cronlint [options]
  --config <path>    Path to OpenClaw config (default: ~/.openclaw/openclaw.json)
  --runs <path>      Path to cron runs dir (default: ~/.openclaw/cron/runs)
  --jobs <path>      Path to jobs.json (default: ~/.openclaw/cron/jobs.json)
  --format json|text Output format (default: text)
  --min-savings <$>  Only show recommendations saving more than this (default: 0.10)
```

## Output
Per-job verdict with:
- Classification (bash-replaceable / model-downgrade / frequency-excessive / right-sized)
- Current cost/day (from run history)
- Recommended change
- Estimated savings/month

## Expected savings
Based on current data:
- watchdog-health (93 runs/day on Sonnet → bash): save ~$1.79/day = $53.70/mo
- git-sync-push (47 runs/day on Sonnet → bash): save ~$0.97/day = $29.22/mo
- anthropic-rate-check (24 runs/day on Sonnet → bash/Haiku): save ~$0.38/day = $11.40/mo
- Total potential: ~$90+/month

## How it classifies
Heuristics based on job payload analysis:
1. Parse the `payload.message` prompt text
2. If the task is: git operations, file deletion, disk checks, process checks → **bash-replaceable**
3. If the task is: simple formatting, templated output, status checks → **model-downgrade** (Haiku)
4. If runs/day > 10 and avg cost > $0.01/run → **frequency-excessive**
5. If the task involves: creative writing, complex reasoning, code generation, multi-step research → **right-sized**

## npm package
- Name: `@aaaaorg/cronlint`
- Works with any OpenClaw/Clawdbot installation
- Zero dependencies (reads JSON files directly)
