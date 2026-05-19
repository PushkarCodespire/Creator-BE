// ===========================================
// AI ERROR HANDLER SERVICE
// ===========================================
// Categorizes and handles OpenAI errors gracefully

import { logError } from '../../utils/logger';

export interface AIError {
    code: string;
    userMessage: string;
    shouldRetry: boolean;
    retryAfter?: number;
}

/**
 * Handles and categorizes OpenAI errors
 */
export function handleOpenAIError(error: unknown): AIError {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'OpenAI Error Handler' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;

    // Rate limit errors
    if (err?.status === 429 || err?.code === 'rate_limit_exceeded') {
        return {
            code: 'RATE_LIMIT',
            userMessage: 'Too many requests. Please try again in a moment.',
            shouldRetry: true,
            retryAfter: 60000 // 1 minute
        };
    }

    // Authentication errors
    if (err?.status === 401 || err?.code === 'invalid_api_key') {
        return {
            code: 'AUTH_ERROR',
            userMessage: 'AI service configuration error. Please contact support.',
            shouldRetry: false
        };
    }

    // Context length errors
    if (err?.code === 'context_length_exceeded') {
        return {
            code: 'CONTEXT_TOO_LONG',
            userMessage: 'Message is too long. Please shorten your message.',
            shouldRetry: false
        };
    }

    // Server errors
    if (err?.status >= 500) {
        return {
            code: 'SERVER_ERROR',
            userMessage: 'AI service is temporarily unavailable. Please try again.',
            shouldRetry: true,
            retryAfter: 30000 // 30 seconds
        };
    }

    // Network errors
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') {
        return {
            code: 'NETWORK_ERROR',
            userMessage: 'Connection error. Please check your internet and try again.',
            shouldRetry: true,
            retryAfter: 10000 // 10 seconds
        };
    }

    // Generic error
    return {
        code: 'UNKNOWN_ERROR',
        userMessage: 'An unexpected error occurred. Please try again.',
        shouldRetry: true,
        retryAfter: 5000 // 5 seconds
    };
}
