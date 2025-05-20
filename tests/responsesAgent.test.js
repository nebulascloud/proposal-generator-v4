const { 
  resetProgress,
  updateProgressStatus,
  getProgress,
  getTokenUsageReport,
  trackTokenUsage
} = require('../agents/responsesAgent');

// Mock the OpenAI client
jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => {
      return {
        responses: {
          create: jest.fn().mockResolvedValue({
            id: 'resp_mock123',
            object: 'response',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Mock response content'
                },
                finish_reason: 'complete'
              }
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          }),
          fork: jest.fn().mockResolvedValue({
            id: 'resp_fork123',
            object: 'response',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Mock forked response content'
                },
                finish_reason: 'complete'
              }
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 60,
              total_tokens: 180
            }
          })
        },
        files: {
          create: jest.fn().mockResolvedValue({
            id: 'file-mock123',
            object: 'file',
            purpose: 'responses'
          })
        }
      };
    })
  };
});

// Mock fs module
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({}),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn()
}));

describe('responsesAgent', () => {
  beforeEach(() => {
    // Reset progress tracking before each test
    resetProgress();
  });

  test('progress tracking state should be properly initialized', () => {
    const progress = getProgress();
    
    // Check structure
    expect(progress).toHaveProperty('phase1');
    expect(progress).toHaveProperty('phase2');
    expect(progress).toHaveProperty('phase3');
    expect(progress).toHaveProperty('phase4');
    expect(progress).toHaveProperty('tokenSummary');
    
    // Check initial values
    expect(progress.phase1.briefAnalysis.status).toBe('pending');
    expect(progress.phase1.briefAnalysis.fileId).toBeNull();
    expect(progress.phase1.briefAnalysis.tokenUsage.total).toBe(0);
  });
  
  test('updateProgressStatus should properly update component status', () => {
    // Update status
    updateProgressStatus('phase1', 'briefAnalysis', 'completed', { fileId: 'file-123' });
    
    const progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('completed');
    expect(progress.phase1.briefAnalysis.fileId).toBe('file-123');
  });
  
  test('token usage report should have proper structure', () => {
    const report = getTokenUsageReport();
    
    expect(report).toHaveProperty('date');
    expect(report).toHaveProperty('overallTokens');
    expect(report).toHaveProperty('phaseBreakdown');
    expect(report).toHaveProperty('componentDetails');
    
    // Check structure of token usage data
    expect(report.overallTokens).toHaveProperty('prompt');
    expect(report.overallTokens).toHaveProperty('completion');
    expect(report.overallTokens).toHaveProperty('total');
  });
  
  test('resetProgress should reset all tracking data', () => {
    // First set some data
    updateProgressStatus('phase1', 'briefAnalysis', 'completed', { fileId: 'file-123' });
    
    // Verify it was set
    let progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('completed');
    
    // Reset and verify
    resetProgress();
    progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('pending');
    expect(progress.phase1.briefAnalysis.fileId).toBeNull();
  });
  
  test('trackTokenUsage should properly update token usage statistics', () => {
    const mockResponse = {
      usage: {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300
      }
    };
    
    // Track token usage
    trackTokenUsage(mockResponse, 'phase1', 'briefAnalysis');
    
    // Verify token usage was tracked
    const progress = getProgress();
    expect(progress.phase1.briefAnalysis.tokenUsage.prompt).toBe(200);
    expect(progress.phase1.briefAnalysis.tokenUsage.completion).toBe(100);
    expect(progress.phase1.briefAnalysis.tokenUsage.total).toBe(300);
    
    // Verify phase summary was updated
    expect(progress.tokenSummary.phase1.total).toBe(300);
    
    // Verify overall summary was updated
    expect(progress.tokenSummary.overall.total).toBe(300);
    
    // Add more token usage and verify accumulation
    const mockResponse2 = {
      usage: {
        prompt_tokens: 150,
        completion_tokens: 50,
        total_tokens: 200
      }
    };
    
    trackTokenUsage(mockResponse2, 'phase1', 'sectionAssignments');
    
    const updatedProgress = getProgress();
    expect(updatedProgress.tokenSummary.phase1.total).toBe(500); // 300 + 200
    expect(updatedProgress.tokenSummary.overall.total).toBe(500);
  });
});
