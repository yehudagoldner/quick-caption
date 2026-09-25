/**
 * Credit system for OpenAI API usage
 * Credits used for API cost accounting; purchase packages are priced separately.
 *
 * Pricing (as of 2025):
 * - Whisper-1: $0.006 per minute
 * - GPT-4o-transcribe: ~$0.006 per minute (token-based, approximate)
 * - GPT-5 text model:
 *   - Input: $1.25 per 1M tokens ($0.00125 per 1K tokens)
 *   - Output: $10 per 1M tokens ($0.01 per 1K tokens)
 *   - Cached input: $0.125 per 1M tokens ($0.000125 per 1K tokens)
 */

const CREDITS_PER_DOLLAR = 40;

// Audio transcription pricing (per minute)
const WHISPER_COST_PER_MINUTE = 0.006; // $0.006 per minute
const GPT4O_TRANSCRIBE_COST_PER_MINUTE = 0.006; // ~$0.006 per minute (approximate, token-based)
const GPT_TRANSCRIBE_COST_PER_MINUTE = 0.0045;

// GPT-5 text model pricing (per 1000 tokens)
const GPT5_INPUT_COST_PER_1K_TOKENS = 0.00125; // $1.25 per 1M tokens
const GPT5_OUTPUT_COST_PER_1K_TOKENS = 0.01; // $10 per 1M tokens
const GPT5_CACHED_INPUT_COST_PER_1K_TOKENS = 0.000125; // $0.125 per 1M tokens

/**
 * Calculate credits needed for audio transcription
 * @param {number} durationMinutes - Audio duration in minutes
 * @param {string} model - Model name (whisper-1, gpt-4o-transcribe, etc.)
 * @returns {number} Credits needed (rounded up)
 */
export function calculateAudioTranscriptionCredits(durationMinutes, model = 'whisper-1') {
  let costPerMinute = WHISPER_COST_PER_MINUTE;

  if (model === 'gpt-transcribe') {
    costPerMinute = GPT_TRANSCRIBE_COST_PER_MINUTE;
  } else if (model.includes('gpt-4o-transcribe') || model.includes('gpt-4o-audio')) {
    costPerMinute = GPT4O_TRANSCRIBE_COST_PER_MINUTE;
  }

  const totalCost = durationMinutes * costPerMinute;
  const credits = totalCost * CREDITS_PER_DOLLAR;

  return Math.ceil(credits); // Round up to ensure we never undercharge
}

/**
 * Calculate credits needed for GPT-5 text completion
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {number} cachedInputTokens - Number of cached input tokens (optional)
 * @returns {number} Credits needed (rounded up)
 */
export function calculateGPT5Credits(inputTokens, outputTokens, cachedInputTokens = 0) {
  const regularInputTokens = inputTokens - cachedInputTokens;

  const inputCost = (regularInputTokens / 1000) * GPT5_INPUT_COST_PER_1K_TOKENS;
  const cachedCost = (cachedInputTokens / 1000) * GPT5_CACHED_INPUT_COST_PER_1K_TOKENS;
  const outputCost = (outputTokens / 1000) * GPT5_OUTPUT_COST_PER_1K_TOKENS;

  const totalCost = inputCost + cachedCost + outputCost;
  const credits = totalCost * CREDITS_PER_DOLLAR;

  return Math.ceil(credits); // Round up to ensure we never undercharge
}

// GPT-6 Luna Standard USD / 1M tokens; Fast is 2x. Keep legacy rates unchanged.
// https://developers.openai.com/api/docs/models/gpt-6-luna
export function calculateTextCredits(inputTokens, outputTokens, cachedTokens = 0, options = {}) {
  if (options.model !== 'gpt-6-luna') {
    return calculateGPT5Credits(inputTokens, outputTokens, cachedTokens);
  }
  const tierMultiplier = ['fast', 'priority'].includes(options.serviceTier) ? 2 : 1;
  const longContext = inputTokens > 272000;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const cached = Math.min(inputTokens, Math.max(0, cachedTokens));
  const cost = ((inputTokens - cached) * 0.10 * inputMultiplier +
    cached * 0.01 * inputMultiplier + outputTokens * 0.50 * outputMultiplier) / 1_000_000;
  return Math.ceil(cost * tierMultiplier * CREDITS_PER_DOLLAR);
}

/**
 * Estimate credits for a full transcription workflow
 * This estimates the total cost before we have exact token counts
 * @param {number} durationMinutes - Audio duration in minutes
 * @param {Object} options - Workflow options
 * @param {string} options.timedModel - Timed transcription model
 * @param {string|null} options.highAccuracyModel - High accuracy model (or null/skip)
 * @param {string|null} options.correctionModel - Correction model (or null)
 * @returns {number} Estimated credits needed (rounded up)
 */
export function estimateTranscriptionCredits(durationMinutes, options = {}) {
  const {
    timedModel = 'whisper-1',
    highAccuracyModel = null,
    correctionModel = null,
    serviceTier = 'default',
  } = options;

  let totalCredits = 0;

  // Stage 1: Timed transcription
  totalCredits += calculateAudioTranscriptionCredits(durationMinutes, timedModel);

  // Stage 2: High accuracy (if enabled)
  if (highAccuracyModel &&
      !['none', 'skip', 'false'].includes(highAccuracyModel.toLowerCase())) {
    totalCredits += calculateAudioTranscriptionCredits(durationMinutes, highAccuracyModel);
  }

  // Stage 3: GPT-5 correction (if enabled)
  if (correctionModel && correctionModel !== 'none') {
    // Estimate: ~100 tokens per minute of audio for input
    // ~120 tokens per minute for output (slightly more due to corrections)
    const estimatedInputTokens = Math.ceil(durationMinutes * 100);
    const estimatedOutputTokens = Math.ceil(durationMinutes * 120);

    totalCredits += calculateTextCredits(estimatedInputTokens, estimatedOutputTokens, 0, {
      model: correctionModel, serviceTier,
    });
  }

  return Math.ceil(totalCredits);
}

/**
 * Calculate actual credits used based on API response metadata
 * @param {Object} usage - Usage metadata from OpenAI API response
 * @returns {number} Actual credits used
 */
export function calculateActualCredits(usage) {
  if (!usage) return 0;

  // For audio models (duration-based)
  if (usage.durationMinutes !== undefined) {
    return calculateAudioTranscriptionCredits(
      usage.durationMinutes,
      usage.model || 'whisper-1'
    );
  }

  // For text models (token-based) - GPT-5 format
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    const inputTokens = usage.inputTokens || 0;
    const outputTokens = usage.outputTokens || 0;
    const cachedTokens = usage.cachedTokens || 0;

    return calculateTextCredits(inputTokens, outputTokens, cachedTokens, usage);
  }

  // Legacy format support
  if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const cachedTokens = usage.cached_tokens || 0;

    return calculateTextCredits(inputTokens, outputTokens, cachedTokens, usage);
  }

  return 0;
}

/**
 * Calculate total credits from full transcription workflow usage
 * @param {Object} usage - Usage object with timedTranscription, highAccuracy, and correction stages
 * @returns {number} Total credits used
 */
export function calculateTotalWorkflowCredits(usage) {
  let totalCredits = 0;

  if (usage.timedTranscription) {
    totalCredits += calculateActualCredits(usage.timedTranscription);
  }

  if (usage.highAccuracy) {
    totalCredits += calculateActualCredits(usage.highAccuracy);
  }

  if (usage.correction) {
    totalCredits += calculateActualCredits(usage.correction);
  }

  return totalCredits;
}

/**
 * Convert credits to dollar amount
 * @param {number} credits - Number of credits
 * @returns {string} Dollar amount formatted as string (e.g., "$0.50")
 */
export function creditsToDollars(credits) {
  const dollars = credits / CREDITS_PER_DOLLAR;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Convert dollar amount to credits
 * @param {number} dollars - Dollar amount
 * @returns {number} Number of credits
 */
export function dollarsToCredits(dollars) {
  return Math.ceil(dollars * CREDITS_PER_DOLLAR);
}
