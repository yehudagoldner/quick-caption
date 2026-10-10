// Versioned, public estimation rules. Actual charging remains server-side.
export function estimateCreditsFromRules(durationSeconds, rules) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new RangeError('Invalid duration');
  if (rules?.version !== 1 || !Number.isFinite(rules.costUSDPerCredit) || rules.costUSDPerCredit <= 0 ||
      !['audioUSDPerMinute', 'inputTokensPerMinute', 'outputTokensPerMinute', 'inputUSDPerToken', 'outputUSDPerToken'].every(key => Number.isFinite(rules[key]) && rules[key] >= 0)) throw new Error('Unsupported credit estimate rules');
  const minutes = durationSeconds / 60;
  const cost = minutes * rules.audioUSDPerMinute + Math.ceil(minutes * rules.inputTokensPerMinute) * rules.inputUSDPerToken + Math.ceil(minutes * rules.outputTokensPerMinute) * rules.outputUSDPerToken;
  return Math.ceil(cost / rules.costUSDPerCredit - 1e-9);
}
