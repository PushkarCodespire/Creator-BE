// ===========================================
// MODEL CONFIG SERVICE — UNIT TESTS
// ===========================================

import { getDefaultConfig, getCreatorConfig } from '../../../services/ai/model-config.service';

describe('ModelConfigService', () => {
  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const config = getDefaultConfig();

      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(2000);
      expect(config.topP).toBe(1);
      expect(config.frequencyPenalty).toBe(0);
      expect(config.presencePenalty).toBe(0);
      expect(config.stream).toBe(true);
    });

    it('should return a new object each time (no shared mutation)', () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      config1.temperature = 999;

      expect(config2.temperature).toBe(0.7);
      expect(config1).not.toBe(config2);
    });

    it('should use OPENAI_MODEL env var or fallback to gpt-4o', () => {
      const config = getDefaultConfig();
      const expected = process.env.OPENAI_MODEL || 'gpt-4o';
      expect(config.model).toBe(expected);
    });
  });

  describe('getCreatorConfig', () => {
    it('should return higher temperature for creative style', () => {
      const config = getCreatorConfig('creative');

      expect(config.temperature).toBe(0.9);
      expect(config.maxTokens).toBe(2000);
    });

    it('should return lower temperature for precise style', () => {
      const config = getCreatorConfig('precise');

      expect(config.temperature).toBe(0.3);
    });

    it('should return default temperature for undefined style', () => {
      const config = getCreatorConfig(undefined);

      expect(config.temperature).toBe(0.7);
    });

    it('should return default temperature for unknown style', () => {
      const config = getCreatorConfig('unknown-style');

      expect(config.temperature).toBe(0.7);
    });

    it('should not mutate the default config', () => {
      getCreatorConfig('creative');
      const defaultConfig = getDefaultConfig();

      expect(defaultConfig.temperature).toBe(0.7);
    });

    // ─── NEW TESTS ──────────────────────────────────────────────────

    it('getCreatorConfig returns a new object (not the DEFAULT_CONFIG reference)', () => {
      const config1 = getCreatorConfig('creative');
      const config2 = getCreatorConfig('creative');
      config1.maxTokens = 9999;
      expect(config2.maxTokens).toBe(2000);
    });

    it('getCreatorConfig preserves maxTokens for creative style', () => {
      const config = getCreatorConfig('creative');
      expect(config.maxTokens).toBe(2000);
    });

    it('getCreatorConfig preserves maxTokens for precise style', () => {
      const config = getCreatorConfig('precise');
      expect(config.maxTokens).toBe(2000);
    });

    it('getCreatorConfig preserves stream=true for all styles', () => {
      expect(getCreatorConfig('creative').stream).toBe(true);
      expect(getCreatorConfig('precise').stream).toBe(true);
      expect(getCreatorConfig(undefined).stream).toBe(true);
    });

    it('getCreatorConfig preserves topP=1 for all styles', () => {
      expect(getCreatorConfig('creative').topP).toBe(1);
      expect(getCreatorConfig('precise').topP).toBe(1);
    });

    it('getCreatorConfig preserves frequencyPenalty=0 and presencePenalty=0', () => {
      const config = getCreatorConfig('creative');
      expect(config.frequencyPenalty).toBe(0);
      expect(config.presencePenalty).toBe(0);
    });

    it('getDefaultConfig includes model field', () => {
      const config = getDefaultConfig();
      expect(typeof config.model).toBe('string');
      expect(config.model.length).toBeGreaterThan(0);
    });

    it('getCreatorConfig with empty string returns default temperature', () => {
      const config = getCreatorConfig('');
      expect(config.temperature).toBe(0.7);
    });

    it('getCreatorConfig with null-like value returns default temperature', () => {
      const config = getCreatorConfig(null as any);
      expect(config.temperature).toBe(0.7);
    });

    it('getCreatorConfig precise has lower temperature than creative', () => {
      const precise = getCreatorConfig('precise');
      const creative = getCreatorConfig('creative');
      expect(precise.temperature).toBeLessThan(creative.temperature);
    });
  });
});
