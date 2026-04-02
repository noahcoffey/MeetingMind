import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger';
import { getSetting } from './store';
import { listRecordings } from './recording-manager';

export interface AnalyticsStats {
  totalRecordings: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  meetingsPerWeekday: number[]; // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  meetingsPerWeek: { week: string; count: number; totalMinutes: number }[];
  topTags: { tag: string; count: number }[];
  longestMeeting: { id: string; title: string; duration: number } | null;
  shortestMeeting: { id: string; title: string; duration: number } | null;
  recentTrend: 'increasing' | 'decreasing' | 'stable';
  totalTranscriptionCost: number;
  averageTranscriptionCost: number;
  transcriptionCostPerWeek: { week: string; cost: number }[];
  sentimentDistribution: { label: string; count: number }[];
}

function getOutputDir(): string {
  return getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind');
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(monday: Date): string {
  return monday.toISOString().slice(0, 10);
}

export function getAnalyticsStats(): AnalyticsStats {
  const recordings = listRecordings();

  const stats: AnalyticsStats = {
    totalRecordings: recordings.length,
    totalDurationSeconds: 0,
    averageDurationSeconds: 0,
    meetingsPerWeekday: [0, 0, 0, 0, 0, 0, 0],
    meetingsPerWeek: [],
    topTags: [],
    longestMeeting: null,
    shortestMeeting: null,
    recentTrend: 'stable',
    totalTranscriptionCost: 0,
    averageTranscriptionCost: 0,
    transcriptionCostPerWeek: [],
    sentimentDistribution: [],
  };

  if (recordings.length === 0) return stats;

  // Compute total/avg duration
  let totalDuration = 0;
  let totalCost = 0;
  let costCount = 0;
  const tagCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};

  for (const rec of recordings) {
    const duration = rec.duration || 0;
    totalDuration += duration;

    // Weekday counts
    try {
      const d = new Date(rec.date);
      stats.meetingsPerWeekday[d.getDay()]++;
    } catch {}

    // Tag counts
    if (Array.isArray(rec.tags)) {
      for (const tag of rec.tags) {
        if (typeof tag === 'string') {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    // Transcription cost
    if ((rec as any).transcriptionCost?.estimatedCost) {
      totalCost += (rec as any).transcriptionCost.estimatedCost;
      costCount++;
    }

    // Sentiment counts
    if ((rec as any).sentiment?.label) {
      const label = (rec as any).sentiment.label;
      sentimentCounts[label] = (sentimentCounts[label] || 0) + 1;
    }

    // Longest/shortest
    if (!stats.longestMeeting || duration > stats.longestMeeting.duration) {
      stats.longestMeeting = { id: rec.id, title: rec.title || 'Untitled', duration };
    }
    if (!stats.shortestMeeting || duration < stats.shortestMeeting.duration) {
      stats.shortestMeeting = { id: rec.id, title: rec.title || 'Untitled', duration };
    }
  }

  stats.totalDurationSeconds = totalDuration;
  stats.averageDurationSeconds = Math.round(totalDuration / recordings.length);

  // Top tags (top 10)
  stats.topTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Meetings per week (last 12 weeks)
  const now = new Date();
  const weekBuckets: { week: string; monday: Date; count: number; totalMinutes: number }[] = [];

  for (let i = 11; i >= 0; i--) {
    const monday = getMonday(new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000));
    weekBuckets.push({
      week: formatWeekLabel(monday),
      monday,
      count: 0,
      totalMinutes: 0,
    });
  }

  for (const rec of recordings) {
    try {
      const recDate = new Date(rec.date);
      const recMonday = getMonday(recDate);
      const bucket = weekBuckets.find(b => b.monday.getTime() === recMonday.getTime());
      if (bucket) {
        bucket.count++;
        bucket.totalMinutes += Math.round((rec.duration || 0) / 60);
      }
    } catch {}
  }

  stats.meetingsPerWeek = weekBuckets.map(({ week, count, totalMinutes }) => ({
    week,
    count,
    totalMinutes,
  }));

  // Recent trend: compare last 4 weeks to previous 4 weeks
  const last4 = weekBuckets.slice(-4);
  const prev4 = weekBuckets.slice(-8, -4);

  const last4Avg = last4.reduce((sum, b) => sum + b.count, 0) / 4;
  const prev4Avg = prev4.reduce((sum, b) => sum + b.count, 0) / 4;

  if (prev4Avg === 0 && last4Avg > 0) {
    stats.recentTrend = 'increasing';
  } else if (prev4Avg > 0) {
    const ratio = last4Avg / prev4Avg;
    if (ratio > 1.2) stats.recentTrend = 'increasing';
    else if (ratio < 0.8) stats.recentTrend = 'decreasing';
    else stats.recentTrend = 'stable';
  }

  // Transcription cost totals
  stats.totalTranscriptionCost = totalCost;
  stats.averageTranscriptionCost = costCount > 0 ? totalCost / costCount : 0;

  // Cost per week (reuse week buckets)
  const costBuckets: Record<string, number> = {};
  for (const b of weekBuckets) costBuckets[b.week] = 0;

  for (const rec of recordings) {
    if ((rec as any).transcriptionCost?.estimatedCost) {
      try {
        const recDate = new Date(rec.date);
        const recMonday = getMonday(recDate);
        const weekLabel = formatWeekLabel(recMonday);
        if (weekLabel in costBuckets) {
          costBuckets[weekLabel] += (rec as any).transcriptionCost.estimatedCost;
        }
      } catch {}
    }
  }

  stats.transcriptionCostPerWeek = weekBuckets.map(b => ({
    week: b.week,
    cost: Math.round(costBuckets[b.week] * 100) / 100,
  }));

  // Sentiment distribution
  stats.sentimentDistribution = Object.entries(sentimentCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return stats;
}

// Claude helper functions (duplicated from notes-generator.ts patterns)
function getClaudePath(): string {
  const candidates = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'claude';
}

function getShellEnv(): Record<string, string> {
  const env = { ...process.env };
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
  ];
  const currentPath = env.PATH || '';
  env.PATH = [...extraPaths, currentPath].join(':');
  return env as Record<string, string>;
}

async function getAnthropicKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'anthropic');
  if (!key) throw new Error('Anthropic API key not configured');
  return key;
}

const TRENDS_PROMPT = 'Based on these recent meeting summaries (titles, dates, durations, and tags), write a brief paragraph (3-5 sentences) analyzing meeting patterns and trends. Note any patterns in frequency, topics, or duration changes.';

async function getTrendsViaCLI(prompt: string): Promise<string> {
  const claudePath = getClaudePath();

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let output = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function getTrendsViaAPI(prompt: string): Promise<string> {
  const apiKey = await getAnthropicKey();
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as any).text?.trim() || '';
}

export async function generateTrendInsights(): Promise<string> {
  const outputDir = getOutputDir();
  const cachePath = path.join(outputDir, 'trends-cache.json');

  // Check cache
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const cacheAge = Date.now() - new Date(cache.timestamp).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000 && cache.insights) {
        return cache.insights;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const recordings = listRecordings();
  const recent = recordings.slice(0, 20);

  if (recent.length === 0) {
    return 'No recordings found to analyze.';
  }

  const summaryLines = recent.map((rec: any) => {
    const tags = Array.isArray(rec.tags) ? rec.tags.join(', ') : '';
    const durationMin = Math.round((rec.duration || 0) / 60);
    return `- "${rec.title || 'Untitled'}" on ${rec.date} (${durationMin} min)${tags ? ` [${tags}]` : ''}`;
  });

  const prompt = `${TRENDS_PROMPT}\n\nRecent meetings:\n${summaryLines.join('\n')}`;

  const provider = getSetting('notesProvider') || 'cli';
  let insights: string;

  if (provider === 'cli') {
    insights = await getTrendsViaCLI(prompt);
  } else {
    insights = await getTrendsViaAPI(prompt);
  }

  // Cache the result
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      timestamp: new Date().toISOString(),
      insights,
    }, null, 2));
  } catch (err: any) {
    log('warn', 'Failed to cache trend insights', { error: err.message });
  }

  return insights;
}
