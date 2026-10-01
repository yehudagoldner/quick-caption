import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const context = new AsyncLocalStorage();
let persistUsage;
export function configureUsageRecorder(recorder) { persistUsage = recorder; }
export function usageContext(req, _res, next) {
  context.run({ operation: req.path, getUserUid: () => req.identity?.uid ?? req.body?.userUid ?? null }, next);
}

// USD / million tokens. Snapshot: 2026-09-30, https://developers.openai.com/api/docs/pricing
// Unknown models/tiers remain unpriced rather than borrowing another model's rate.
const TEXT_RATES = {
  'gpt-5': [1.25, 0.125, 10], 'gpt-5.1': [1.25, 0.125, 10],
  'gpt-5.2': [1.75, 0.175, 14], 'gpt-5-mini': [0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.005, 0.4], 'gpt-6-luna': [0.10, 0.01, 0.50],
  'gpt-6.1-sol': [2, 0.1, 10], 'gpt-6-astra': [10, 1, 50],
  'gpt-4o': [2.5, 1.25, 10], 'gpt-4o-mini': [0.15, 0.075, 0.6],
};
const AUDIO_RATES = { 'whisper-1': 0.006, 'gpt-transcribe': 0.0045, 'gpt-4o-transcribe': 0.006, 'gpt-4o-mini-transcribe': 0.003 };
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const baseModel = model => model.replace(/-\d{4}-\d{2}-\d{2}$/, '');

export function priceUsage({ model, usage, serviceTier = 'default', durationSeconds = null, audio = false }) {
  const inputTokens = count(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = count(usage?.output_tokens ?? usage?.completion_tokens);
  const cachedTokens = Math.min(inputTokens, count(usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens));
  const result = { inputTokens, outputTokens, cachedTokens, durationSeconds, costUSD: null, costBasis: 'unpriced' };
  const name = baseModel(model);
  if (audio) {
    if (durationSeconds !== null && AUDIO_RATES[name] !== undefined) {
      result.costUSD = durationSeconds / 60 * AUDIO_RATES[name];
      result.costBasis = name === 'whisper-1' || name === 'gpt-transcribe' ? 'duration' : 'audio-estimate';
    }
    return result;
  }
  if (!usage || (usage.input_tokens === undefined && usage.prompt_tokens === undefined)) return result;
  const rates = TEXT_RATES[name];
  if (!rates || !['default', 'standard', 'fast', 'priority', 'flex'].includes(serviceTier)) return result;
  const multiplier = ['fast', 'priority'].includes(serviceTier) ? 2 : serviceTier === 'flex' ? 0.5 : 1;
  const long = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].includes(name) && inputTokens > 272000;
  result.costUSD = ((inputTokens - cachedTokens) * rates[0] * (long ? 2 : 1) +
    cachedTokens * rates[1] * (long ? 2 : 1) + outputTokens * rates[2] * (long ? 1.5 : 1)) / 1e6 * multiplier;
  result.costBasis = 'tokens';
  return result;
}

export function instrumentOpenAI(client, getAudioDuration) {
  for (const [resource, audio] of [[client.responses, false], [client.chat.completions, false], [client.audio.transcriptions, true]]) {
    const create = resource.create.bind(resource);
    resource.create = async (...args) => {
      const request = args[0], scope = context.getStore();
      // CLI tools and isolated unit tests do not write server accounting records.
      if (!persistUsage || !scope) return create(...args);
      let response, apiError;
      try { response = await create(...args); } catch (error) { apiError = error; }
      let durationSeconds = null;
      if (audio && response) {
        const reported = response.duration ?? response.usage?.seconds;
        if (Number.isFinite(reported)) durationSeconds = reported;
        else try { durationSeconds = await getAudioDuration(request.file.path); } catch { /* Visible as unpriced. */ }
      }
      const model = request.model, serviceTier = response?.service_tier ?? request.service_tier ?? 'default';
      const usage = response?.usage ?? null;
      const priced = priceUsage({ model, usage, serviceTier, durationSeconds, audio });
      if (apiError) { priced.costUSD = null; priced.costBasis = 'unknown-failed'; }
      const uid = scope.getUserUid();
      const row = { id: randomUUID(), userUid: typeof uid === 'string' ? uid.slice(0, 128) : null,
        operation: scope.operation.slice(0, 100), model, serviceTier, status: apiError ? 'failed' : 'completed', ...priced, usage };
      // Await accounting before the pipeline discards the provider response or parses its text.
      // Reuse the event ID on persistence retries so a lost DB response cannot count it twice.
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await persistUsage(row); saved = true; break; }
        catch (error) { if (attempt === 2) console.error('AI usage persistence failed:', error.code ?? error.name); }
      }
      if (!saved) throw new Error('שמירת נתוני עלות ה־AI נכשלה.');
      if (apiError) throw apiError;
      return response;
    };
  }
  return client;
}
