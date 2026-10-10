import { priceUsage } from './aiUsage.js';
import { CREDIT_PACKAGES } from './creditPackages.js';

/**
 * Credits are charged from the real AI cost of each job, rounded up once, so every job earns
 * the same multiple of its cost. The multiple is guaranteed at the cheapest per-credit package;
 * smaller packages earn proportionally more. Model rates come from priceUsage (src/aiUsage.js).
 */
export const PROFIT_MULTIPLE = 10;
export const LOWEST_CREDIT_PRICE_USD = Math.min(...CREDIT_PACKAGES.map(pkg => Number(pkg.priceUSD) / pkg.credits));
export const COST_USD_PER_CREDIT = LOWEST_CREDIT_PRICE_USD / PROFIT_MULTIPLE;

// Unknown models are charged at these models' rates rather than for free.
const FALLBACK_AUDIO_MODEL = 'whisper-1';
const FALLBACK_TEXT_MODEL = 'gpt-5';

export function creditsForCost(costUSD) {
  if (!Number.isFinite(costUSD) || costUSD <= 0) return 0;
  return Math.ceil(costUSD / COST_USD_PER_CREDIT - 1e-9);
}

export function audioTranscriptionCost(durationMinutes, model = FALLBACK_AUDIO_MODEL) {
  const durationSeconds = Math.max(0, Number(durationMinutes) || 0) * 60;
  return priceUsage({ model: model || FALLBACK_AUDIO_MODEL, durationSeconds, audio: true }).costUSD
    ?? priceUsage({ model: FALLBACK_AUDIO_MODEL, durationSeconds, audio: true }).costUSD;
}

export function textCost(inputTokens, outputTokens, cachedTokens = 0, { model = FALLBACK_TEXT_MODEL, serviceTier = 'default' } = {}) {
  const usage = { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: { cached_tokens: cachedTokens } };
  return priceUsage({ model: model || FALLBACK_TEXT_MODEL, usage, serviceTier: serviceTier || 'default' }).costUSD
    ?? priceUsage({ model: FALLBACK_TEXT_MODEL, usage }).costUSD;
}

function shouldRunHighAccuracy(model) {
  return Boolean(model) && !['none', 'skip', 'false'].includes(model.trim().toLowerCase());
}

// Measured correction usage per audio minute, reasoning included. A completed job whose real charge
// exceeds the balance is delivered uncharged, so the pre-check must not underestimate.
const CORRECTION_INPUT_TOKENS_PER_MINUTE = 1500;
const CORRECTION_OUTPUT_TOKENS_PER_MINUTE = 5000;

// Estimate the AI cost of a full transcription before running it (balance pre-check only).
export function estimateTranscriptionCost(durationMinutes, { timedModel = FALLBACK_AUDIO_MODEL, highAccuracyModel = null, correctionModel = null, serviceTier = 'default' } = {}) {
  let cost = audioTranscriptionCost(durationMinutes, timedModel);
  if (shouldRunHighAccuracy(highAccuracyModel)) cost += audioTranscriptionCost(durationMinutes, highAccuracyModel);
  if (correctionModel && correctionModel !== 'none') {
    cost += textCost(Math.ceil(durationMinutes * CORRECTION_INPUT_TOKENS_PER_MINUTE), Math.ceil(durationMinutes * CORRECTION_OUTPUT_TOKENS_PER_MINUTE), 0, { model: correctionModel, serviceTier });
  }
  return cost;
}

export function estimateTranscriptionCredits(durationMinutes, options = {}) {
  return creditsForCost(estimateTranscriptionCost(durationMinutes, options));
}

export function transcriptionEstimateRules({ timedModel = FALLBACK_AUDIO_MODEL, highAccuracyModel = null, correctionModel = null, serviceTier = 'default' } = {}) {
  const correction = correctionModel && correctionModel !== 'none';
  return { version: 1, costUSDPerCredit: COST_USD_PER_CREDIT,
    audioUSDPerMinute: audioTranscriptionCost(1, timedModel) + (shouldRunHighAccuracy(highAccuracyModel) ? audioTranscriptionCost(1, highAccuracyModel) : 0),
    inputTokensPerMinute: correction ? CORRECTION_INPUT_TOKENS_PER_MINUTE : 0,
    outputTokensPerMinute: correction ? CORRECTION_OUTPUT_TOKENS_PER_MINUTE : 0,
    inputUSDPerToken: correction ? textCost(1, 0, 0, { model: correctionModel, serviceTier }) : 0,
    outputUSDPerToken: correction ? textCost(0, 1, 0, { model: correctionModel, serviceTier }) : 0 };
}

function stageCost(usage) {
  if (!usage) return 0;
  if (usage.durationMinutes !== undefined) return audioTranscriptionCost(usage.durationMinutes, usage.model);
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    return textCost(usage.inputTokens || 0, usage.outputTokens || 0, usage.cachedTokens || 0, usage);
  }
  return 0;
}

// AI cost implied by the stage usage a transcription reports.
export function workflowCost(usage = {}) {
  return stageCost(usage.timedTranscription) + stageCost(usage.highAccuracy) + stageCost(usage.correction);
}

/**
 * Credits for a finished transcription. measuredCostUSD is the summed cost of every AI call the
 * job made (see measureAICost); the reported stage usage is a floor in case some calls were unpriced.
 */
export function transcriptionCredits(usage = {}, measuredCostUSD = 0) {
  return creditsForCost(Math.max(Number(measuredCostUSD) || 0, workflowCost(usage)));
}

export function calculateTotalWorkflowCredits(usage = {}) {
  return transcriptionCredits(usage);
}

// What the credits cost the user at the cheapest package (for messages and logs).
export function creditsToDollars(credits) {
  return `$${(credits * LOWEST_CREDIT_PRICE_USD).toFixed(2)}`;
}
