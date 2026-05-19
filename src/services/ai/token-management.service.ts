// ===========================================
// AI TOKEN MANAGEMENT SERVICE
// ===========================================
// Handles token estimation, cost calculation, and context optimization
// Uses tiktoken when available; falls back to heuristic estimates otherwise

type TiktokenEncoding = {
    encode: (text: string) => number[];
    decode: (tokens: number[]) => Uint8Array;
    free: () => void;
};

type TiktokenModule = {
    encoding_for_model: (model: string) => TiktokenEncoding;
};

let cachedTiktoken: TiktokenModule | null | undefined;

function getTiktokenEncoder(model: string): TiktokenEncoding | null {
    if (cachedTiktoken === undefined) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            cachedTiktoken = require("tiktoken") as TiktokenModule;
        } catch {
            cachedTiktoken = null;
        }
    }

    if (!cachedTiktoken) return null;

    try {
        return cachedTiktoken.encoding_for_model(model);
    } catch {
        return null;
    }
}

/**
 * Estimates token count for a string
 */
export function estimateTokens(text: string, model: string = "gpt-4"): number {
    const encoder = getTiktokenEncoder(model);
    if (!encoder) {
        // Fallback estimation (roughly 4 chars per token)
        return Math.ceil(text.length / 4);
    }

    try {
        const tokens = encoder.encode(text);
        return tokens.length;
    } catch {
        return Math.ceil(text.length / 4);
    } finally {
        encoder.free();
    }
}

/**
 * Validates if the context fits within the model's limit
 */
export function validateTokenLimit(text: string, limit: number, model: string = "gpt-4"): boolean {
    return estimateTokens(text, model) <= limit;
}

/**
 * Truncates text to fit within a token limit
 */
export function truncateToTokenLimit(text: string, limit: number, model: string = "gpt-4"): string {
    const encoder = getTiktokenEncoder(model);
    if (!encoder) {
        return text.substring(0, limit * 4);
    }

    try {
        const tokens = encoder.encode(text);

        if (tokens.length <= limit) {
            return text;
        }

        const truncatedTokens = tokens.slice(0, limit);
        const decoder = new TextDecoder();
        return decoder.decode(encoder.decode(truncatedTokens));
    } catch {
        return text.substring(0, limit * 4);
    } finally {
        encoder.free();
    }
}

/**
 * Calculates estimated cost for OpenAI usage (in USD)
 */
export function calculateCost(promptTokens: number, completionTokens: number, model: string): number {
    const rates: Record<string, { prompt: number; completion: number }> = {
        'gpt-4': { prompt: 0.03, completion: 0.06 },
        'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
        'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
        'gpt-4o': { prompt: 0.005, completion: 0.015 },
    };

    const rate = rates[model] || rates['gpt-4o'];
    return (promptTokens / 1000) * rate.prompt + (completionTokens / 1000) * rate.completion;
}
