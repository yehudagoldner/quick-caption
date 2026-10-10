import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { estimateTranscriptionCredits, transcriptionEstimateRules } from './creditCalculator.js';
import { MAX_MEDIA_BYTES, VIDEO_RETENTION_DAYS } from './mediaPolicy.js';
import { parseTranscriptionSettings, TRANSCRIPTION_LANGUAGE_CODES, SECONDARY_LANGUAGE_MODES } from './transcriptionSettings.js';

// Both the upload pre-check and the plugin quote use these exact server settings.
export function currentTranscriptionModels(env = process.env) {
  return {
    timedModel: env.OPENAI_TIMED_MODEL ?? 'whisper-1',
    highAccuracyModel: env.OPENAI_HIGH_ACCURACY_MODEL ?? 'gpt-4o-transcribe',
    correctionModel: env.OPENAI_CORRECTION_MODEL ?? 'gpt-5',
    serviceTier: env.OPENAI_TEXT_SERVICE_TIER,
  };
}

const policySources = ['creditCalculator.js', 'creditEstimate.js', 'creditPackages.js', 'aiUsage.js', 'transcriptionSettings.js', 'mediaPolicy.js']
  .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

export function pluginPolicy() {
  const models = currentTranscriptionModels();
  const minPluginVersion = /^\d+\.\d+\.\d+$/.test(process.env.PLUGIN_MIN_VERSION || '') ? process.env.PLUGIN_MIN_VERSION : '1.0.0';
  const version = createHash('sha256').update(policySources).update(JSON.stringify({ models, minPluginVersion })).digest('hex').slice(0, 24);
  return {
    version, protocolVersion: 1, minPluginVersion,
    maxMediaBytes: MAX_MEDIA_BYTES, retentionDays: VIDEO_RETENTION_DAYS,
    defaults: parseTranscriptionSettings(), languages: TRANSCRIPTION_LANGUAGE_CODES,
    secondaryLanguageModes: SECONDARY_LANGUAGE_MODES,
    balanceRefreshSeconds: 30,
    billing: 'actual-ai-cost',
    creditEstimate: transcriptionEstimateRules(models),
  };
}

export function pluginVersionSupported(version, policy = pluginPolicy()) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const client = version.split('.').map(Number), minimum = policy.minPluginVersion.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (client[i] !== minimum[i]) return client[i] > minimum[i];
  return true;
}

export function quoteTranscription(durationSeconds) {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError('נדרש משך קובץ תקין בשניות');
  }
  return estimateTranscriptionCredits(durationSeconds / 60, currentTranscriptionModels());
}
