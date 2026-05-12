/**
 * LLM cost calculation using @pydantic/genai-prices.
 */
const { calcPrice } = require('@pydantic/genai-prices');

// Free models (no cost regardless of pricing data)
export const FREE_MODELS = new Set([
  'xiaomi/mimo-v2-pro',
  'mimo-v2-pro',
]);

// Hermes billing_provider → genai-prices providerId mapping
export const PROVIDER_MAP: Record<string, string> = {
  'openrouter':    'openrouter',
  'openai-codex':  'openai',
  'opencode-go':   'openrouter',
};

// Custom pricing for models not in genai-prices (per million tokens)
export const CUSTOM_PRICING: Record<string, { input_mtok: number; output_mtok: number; cache_read_mtok: number }> = {
  'minimax-m2':   { input_mtok: 0.30, output_mtok: 1.20, cache_read_mtok: 0.03 },
  'minimax-m2.7': { input_mtok: 0.30, output_mtok: 1.20, cache_read_mtok: 0.03 },
};

/**
 * Calculate cost in USD from token counts.
 */
export function calculateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  billingProvider?: string,
): number {
  if (!model || FREE_MODELS.has(model)) return 0;

  const usage = {
    input_tokens: inputTokens + cacheReadTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
  };

  // 1. Try with provider hint
  const providerId = billingProvider ? PROVIDER_MAP[billingProvider] : undefined;
  if (providerId) {
    try {
      const r = calcPrice(usage, model, { providerId });
      if (r) return r.total_price;
    } catch (_) { /* fallback to next */ }
  }

  // 2. Try without provider (match across all providers)
  try {
    const r = calcPrice(usage, model);
    if (r) return r.total_price;
  } catch (_) { /* fallback to custom pricing */ }

  // 3. Custom pricing fallback
  const custom = CUSTOM_PRICING[model];
  if (custom) {
    return (inputTokens / 1e6) * custom.input_mtok
      + (outputTokens / 1e6) * custom.output_mtok
      + (cacheReadTokens / 1e6) * (custom.cache_read_mtok || custom.input_mtok * 0.1);
  }

  return 0;
}
