// ===========================================
// AI MODEL CONFIGURATION SERVICE
// ===========================================

export interface AIModelConfig {
    model: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
}

const DEFAULT_CONFIG: AIModelConfig = {
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2000,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: true
};

/**
 * Gets the default model configuration
 */
export function getDefaultConfig(): AIModelConfig {
    return { ...DEFAULT_CONFIG };
}

/**
 * Gets customized config for a specific creator style
 */
export function getCreatorConfig(style?: string): AIModelConfig {
    const config = { ...DEFAULT_CONFIG };

    if (style === 'creative') {
        config.temperature = 0.9;
    } else if (style === 'precise') {
        config.temperature = 0.3;
    }

    return config;
}
