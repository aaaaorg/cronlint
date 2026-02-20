#!/usr/bin/env node
// cronlint — Cron Job Cost & Intelligence Auditor
// Analyzes OpenClaw cron jobs: which need AI, which are overkill, which cost too much.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const DEFAULTS = {
  configPath: join(homedir(), '.openclaw', 'openclaw.json'),
  jobsPath: join(homedir(), '.openclaw', 'cron', 'jobs.json'),
  runsDir: join(homedir(), '.openclaw', 'cron', 'runs'),
  format: 'text',
  minSavings: 0.10,
  hours: 24,
};

// Cost per 1M tokens (input+output avg estimate)
const MODEL_COSTS = {
  'claude-opus-4-6': 30,
  'claude-opus-4-5': 30,
  'claude-sonnet-4-5': 6,
  'claude-sonnet-4-0': 6,
  'claude-3-5-sonnet': 6,
  'claude-3-5-haiku': 1.6,
  'claude-haiku-3-5': 1.6,
  'haiku': 1.6,
  'sonnet': 6,
  'opus': 30,
};

// Keywords that suggest a bash script could handle the task
const BASH_PATTERNS = [
  /\bgit\s+(push|pull|status|add|commit)\b/i,
  /\brm\s+-/i,
  /\bfind\s+.*-delete\b/i,
  /\bclean(up|ing|ed)?\b.*\b(session|file|log)/i,
  /\bdelete\s+(old|stale|expired)/i,
  /\bcheck\s+(if|whether|that)\s+.*\b(running|alive|process|port)\b/i,
  /\bps\s+aux/i,
  /\bdisk\s+(space|usage)/i,
  /\bdf\s+-/i,
  /\bdu\s+-/i,
  /\blog\s+rotat/i,
  /\bsync.*push/i,
  /\bgit-sync/i,
  /\bwatchdog/i,
  /\bhealth\s*check/i,
  /\bkill\s+/i,
  /\bpkill\b/i,
  /\bsystemctl\b/i,
  /\bcurl\s+.*status/i,
  /\brate.limit.*check/i,
  /\brun\b.*\.sh\b/i,
  /\breply\s+HEARTBEAT_OK\s+if\s+nothing/i,
  /\breport\s+(output|result)\s+(only\s+)?if/i,
];

// Keywords suggesting simple tasks Haiku could handle
const HAIKU_PATTERNS = [
  /\bsummar(y|ize|ise)\b/i,
  /\bformat\s+(as|into|for)\b/i,
  /\blist\s+(all|the)\b/i,
  /\bcount\s+(the|how)\b/i,
  /\bextract\s+(key|main|important)\b/i,
  /\btemplate/i,
  /\bsimple\s+report/i,
];

// Keywords suggesting real AI reasoning is needed
const AI_NEEDED_PATTERNS = [
  /\b(write|create|generate|compose)\s+(a|an|the)?\s*(article|post|story|essay|product|content|code|app)/i,
  /\b(analyze|research|investigate|deep.dive)\b/i,
  /\b(creative|brainstorm|ideate)\b/i,
  /\b(build|implement|develop|architect)\b/i,
  /\b(review|audit|evaluate)\s+(code|design|architecture)/i,
  /\bcodex\b/i,
  /\bweb.*search/i,
];

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config': opts.configPath = resolve(argv[++i]); break;
      case '--jobs': opts.jobsPath = resolve(argv[++i]); break;
      case '--runs': opts.runsDir = resolve(argv[++i]); break;
      case '--format': opts.format = argv[++i]; break;
      case '--min-savings': opts.minSavings = parseFloat(argv[++i]); break;
      case '--hours': opts.hours = parseInt(argv[++i]); break;
      case '--help':
        console.log(`cronlint — Cron Job Cost & Intelligence Auditor

Usage: cronlint [options]
  --config <path>      OpenClaw config (default: ~/.openclaw/openclaw.json)
  --jobs <path>        jobs.json path (default: ~/.openclaw/cron/jobs.json)
  --runs <path>        Runs directory (default: ~/.openclaw/cron/runs)
  --format json|text   Output format (default: text)
  --hours <n>          Analysis window in hours (default: 24)
  --min-savings <$>    Min daily savings to show (default: 0.10)
  --help               Show this help`);
        process.exit(0);
    }
  }
  return opts;
}

function loadJobs(jobsPath) {
  const raw = JSON.parse(readFileSync(jobsPath, 'utf8'));
  const jobs = raw.jobs || (Array.isArray(raw) ? raw : []);
  return jobs;
}

function loadRuns(runsDir, jobId, cutoffMs) {
  const runFile = join(runsDir, `${jobId}.jsonl`);
  if (!existsSync(runFile)) return [];
  const lines = readFileSync(runFile, 'utf8').trim().split('\n');
  const runs = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.ts >= cutoffMs && entry.action === 'finished') {
        runs.push(entry);
      }
    } catch {}
  }
  return runs;
}

function getModel(job) {
  return job.payload?.model || 'sonnet';
}

function getPrompt(job) {
  return job.payload?.message || '';
}

function estimateCostPerRun(runs, model) {
  if (runs.length === 0) return { totalCost: 0, avgCost: 0, totalTokens: 0, runCount: 0 };
  let totalTokens = 0;
  let totalCost = 0;
  // Cost per 1M tokens (rough input+output blend)
  const modelKey = Object.keys(MODEL_COSTS).find(k => (model || '').includes(k)) || 'sonnet';
  const costPerMToken = MODEL_COSTS[modelKey] || 6;
  
  for (const run of runs) {
    const tokens = (run.inputTokens || 0) + (run.outputTokens || 0);
    totalTokens += tokens;
    // Use recorded cost if available, otherwise estimate from summary length
    if (run.cost) {
      totalCost += run.cost;
    } else {
      // Estimate: typical cron run uses ~10-50K tokens based on summary length
      const summaryLen = (run.summary || '').length;
      const estTokens = Math.max(5000, summaryLen * 2); // rough estimate
      totalCost += (estTokens / 1_000_000) * costPerMToken;
    }
  }
  return {
    totalCost: Math.round(totalCost * 10000) / 10000,
    avgCost: Math.round((totalCost / runs.length) * 10000) / 10000,
    totalTokens,
    runCount: runs.length,
  };
}

function classifyJob(job, runs, hours) {
  const prompt = getPrompt(job);
  const model = getModel(job);
  const name = job.name || job.id;
  const stats = estimateCostPerRun(runs, model);
  const runsPerDay = stats.runCount * (24 / hours);

  const result = {
    name,
    id: job.id,
    enabled: job.enabled !== false,
    model,
    schedule: formatSchedule(job.schedule),
    runsPerDay: Math.round(runsPerDay * 10) / 10,
    costPerDay: Math.round(stats.totalCost * (24 / hours) * 10000) / 10000,
    avgCostPerRun: Math.round(stats.avgCost * 10000) / 10000,
    totalTokens: stats.totalTokens,
    classification: 'right-sized',
    recommendation: null,
    estimatedSavingsPerDay: 0,
  };

  // Check bash-replaceable
  const bashScore = BASH_PATTERNS.reduce((s, p) => s + (p.test(prompt) ? 1 : 0), 0);
  const aiScore = AI_NEEDED_PATTERNS.reduce((s, p) => s + (p.test(prompt) ? 1 : 0), 0);
  const haikuScore = HAIKU_PATTERNS.reduce((s, p) => s + (p.test(prompt) ? 1 : 0), 0);

  // Estimate runs/day from schedule if no run data
  if (stats.runCount === 0 && job.schedule) {
    const s = job.schedule;
    if (s.kind === 'every' && s.everyMs) {
      result.runsPerDay = Math.round((86400000 / s.everyMs) * 10) / 10;
    } else if (s.kind === 'cron' && s.expr) {
      const parts = s.expr.split(/\s+/);
      if (parts[0]?.startsWith('*/')) {
        const interval = parseInt(parts[0].slice(2));
        if (parts[1] === '*') result.runsPerDay = Math.round((1440 / interval) * 10) / 10;
        else result.runsPerDay = Math.round((60 / interval) * 10) / 10;
      } else if (parts[1] === '*') {
        result.runsPerDay = 24;
      } else {
        result.runsPerDay = 1;
      }
    }
  }

  if (bashScore >= 2 && aiScore === 0) {
    result.classification = 'bash-replaceable';
    result.recommendation = `Replace with bash script. Current: ${model} @ $${result.costPerDay}/day`;
    result.estimatedSavingsPerDay = result.costPerDay;
  } else if (runsPerDay > 10 && result.avgCostPerRun > 0.005) {
    result.classification = 'frequency-excessive';
    const suggestedFreq = Math.max(4, Math.round(runsPerDay / 4));
    result.recommendation = `Reduce from ${result.runsPerDay}/day to ${suggestedFreq}/day (or switch to bash)`;
    result.estimatedSavingsPerDay = result.costPerDay * 0.75;
  } else if (haikuScore > 0 && aiScore === 0 && !model.includes('haiku')) {
    result.classification = 'model-downgrade';
    const ratio = (MODEL_COSTS[model] || 6) / 1.6;
    result.recommendation = `Downgrade to Haiku (${ratio.toFixed(1)}x cheaper)`;
    result.estimatedSavingsPerDay = result.costPerDay * (1 - 1 / ratio);
  }

  result.estimatedSavingsPerMonth = Math.round(result.estimatedSavingsPerDay * 30 * 100) / 100;

  return result;
}

function formatSchedule(schedule) {
  if (!schedule) return 'unknown';
  if (schedule.kind === 'cron') return schedule.expr;
  if (schedule.kind === 'every') return `every ${Math.round(schedule.everyMs / 60000)}m`;
  if (schedule.kind === 'at') return `at ${schedule.at}`;
  return JSON.stringify(schedule);
}

function formatText(results, minSavings) {
  const B = '\x1b[1m', R = '\x1b[31m', Y = '\x1b[33m', G = '\x1b[32m', C = '\x1b[36m', D = '\x1b[2m', N = '\x1b[0m';

  const classColors = {
    'bash-replaceable': R,
    'frequency-excessive': Y,
    'model-downgrade': C,
    'right-sized': G,
  };

  const classEmoji = {
    'bash-replaceable': '🔧',
    'frequency-excessive': '⚡',
    'model-downgrade': '📉',
    'right-sized': '✅',
  };

  let out = `${B}🔍 cronlint — Cron Job Audit${N}\n`;
  out += '─'.repeat(70) + '\n\n';

  // Sort by savings descending
  const sorted = [...results].sort((a, b) => b.estimatedSavingsPerDay - a.estimatedSavingsPerDay);
  const actionable = sorted.filter(r => r.classification !== 'right-sized' && r.estimatedSavingsPerDay >= minSavings);
  const ok = sorted.filter(r => r.classification === 'right-sized' || r.estimatedSavingsPerDay < minSavings);

  if (actionable.length > 0) {
    out += `${B}⚠️  Action Required (${actionable.length} jobs)${N}\n\n`;
    for (const r of actionable) {
      const color = classColors[r.classification] || '';
      const emoji = classEmoji[r.classification] || '';
      out += `${emoji} ${color}${B}${r.name}${N} ${D}(${r.schedule})${N}\n`;
      out += `   ${color}${r.classification}${N} · model: ${r.model} · ${r.runsPerDay} runs/day · $${r.costPerDay.toFixed(2)}/day\n`;
      out += `   💡 ${r.recommendation}\n`;
      out += `   💰 Save: ${G}$${r.estimatedSavingsPerMonth.toFixed(2)}/month${N}\n\n`;
    }
  }

  if (ok.length > 0) {
    out += `${B}✅ Right-Sized (${ok.length} jobs)${N}\n`;
    for (const r of ok) {
      const status = r.enabled ? '' : ` ${D}[disabled]${N}`;
      out += `   ${r.name}${status} · ${r.model} · $${r.costPerDay.toFixed(2)}/day\n`;
    }
  }

  const totalSavings = actionable.reduce((s, r) => s + r.estimatedSavingsPerMonth, 0);
  out += `\n${B}📊 Total potential savings: $${totalSavings.toFixed(2)}/month${N}\n`;

  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  
  if (!existsSync(opts.jobsPath)) {
    console.error(`Error: jobs file not found at ${opts.jobsPath}`);
    process.exit(1);
  }

  const jobs = loadJobs(opts.jobsPath);
  const cutoffMs = Date.now() - opts.hours * 3600 * 1000;
  
  const results = jobs.map(job => {
    const runs = loadRuns(opts.runsDir, job.id, cutoffMs);
    return classifyJob(job, runs, opts.hours);
  });

  if (opts.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatText(results, opts.minSavings));
  }
}

main();
