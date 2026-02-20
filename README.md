# @aaaaorg/cronlint

Cron job cost & intelligence auditor for [OpenClaw](https://github.com/openclaw/openclaw).

Analyzes your cron jobs and tells you which ones are wasting money on AI models when a bash script would do.

## Install

```bash
npm install -g @aaaaorg/cronlint
```

## Usage

```bash
cronlint                          # Audit all jobs (last 24h)
cronlint --hours 48               # Wider analysis window
cronlint --format json            # Machine-readable output
cronlint --min-savings 1.00       # Only show big savings
```

## What it finds

| Classification | Meaning | Action |
|---|---|---|
| 🔧 bash-replaceable | Job runs a shell script — AI not needed | Replace with bash/cron |
| ⚡ frequency-excessive | Runs too often for what it does | Reduce frequency |
| 📉 model-downgrade | Uses Opus/Sonnet but Haiku would suffice | Switch to cheaper model |
| ✅ right-sized | Job needs the model it's using | No action needed |

## Example output

```
🔍 cronlint — Cron Job Audit

⚠️  Action Required (3 jobs)

🔧 watchdog-health (*/15 * * * *)
   bash-replaceable · model: claude-sonnet-4-5 · 96 runs/day · $2.88/day
   💡 Replace with bash script
   💰 Save: $86.40/month

⚡ rate-check (0 * * * *)
   frequency-excessive · model: claude-sonnet-4-5 · 24 runs/day · $0.72/day
   💡 Reduce from 24/day to 6/day
   💰 Save: $16.20/month

📊 Total potential savings: $102.60/month
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--config` | `~/.openclaw/openclaw.json` | OpenClaw config path |
| `--jobs` | `~/.openclaw/cron/jobs.json` | Jobs file path |
| `--runs` | `~/.openclaw/cron/runs` | Runs directory |
| `--format` | `text` | Output: `text` or `json` |
| `--hours` | `24` | Analysis window |
| `--min-savings` | `0.10` | Min daily savings to report |

## How it works

1. Reads your OpenClaw cron job definitions and run history
2. Analyzes each job's prompt text with pattern matching
3. Classifies by whether the task actually needs an AI model
4. Estimates costs from run history and model pricing
5. Reports actionable recommendations with savings estimates

## License

MIT
