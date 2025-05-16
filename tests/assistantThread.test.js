const { initializeThread, getAssistantResponse } = require('../agents/assistantAgent');
const { customerBrief } = require('./fixtures/customerBrief');

// Force test environment
process.env.NODE_ENV = 'test';

describe('Assistant Thread Context Management', () => {
  it('initializeThread returns a thread object with an id', async () => {
    const thread = await initializeThread(customerBrief);
    expect(thread).toHaveProperty('id', 'test-thread-id');
  });

  it('getAssistantResponse accepts options for context management', async () => {
    const assistantId = 'test-assistant';
    const message = 'Test message';
    
    // Test with skipContextReminder = false (default)
    const response1 = await getAssistantResponse(assistantId, message, 'test-thread-id');
    expect(response1).toBe(`Test assistant response for ${assistantId}`);
    
    // Test with skipContextReminder = true
    const response2 = await getAssistantResponse(
      assistantId, 
      message, 
      'test-thread-id', 
      { skipContextReminder: true }
    );
    expect(response2).toBe(`Test assistant response for ${assistantId}`);
    
    // In the stub implementation both results should be the same
    // In production, the message format would differ
    expect(response1).toEqual(response2);
  });
});
