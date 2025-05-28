/**
 * Tests for correct parameter handling in responsesAgent functions
 */

const { trackTokenUsage, getProgress, resetProgress } = require('../agents/responsesAgent');

describe('Parameter handling in responsesAgent', () => {
  beforeEach(() => {
    resetProgress();
  });

  describe('trackTokenUsage', () => {
    const mockResponse = {
      usage: {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300
      }
    };

    test('should accept parameters in the correct order', () => {
      // Use the proper parameter order
      trackTokenUsage(mockResponse, 'phase1', 'briefAnalysis');
      
      // Verify token usage was tracked correctly
      const progress = getProgress();
      expect(progress.phase1.briefAnalysis.tokenUsage.prompt).toBe(200);
      expect(progress.phase1.briefAnalysis.tokenUsage.completion).toBe(100);
      expect(progress.phase1.briefAnalysis.tokenUsage.total).toBe(300);
      
      // Verify phase summary was also updated
      expect(progress.tokenSummary.phase1.total).toBe(300);
    });
  });
});
