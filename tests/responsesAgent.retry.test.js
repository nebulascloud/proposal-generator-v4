// tests/responsesAgent.retry.test.js
const responsesAgent = require('../agents/responsesAgent');
const { retryWithBackoff } = require('../utils/apiRetryHelper');

jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      responses: {
        create: jest.fn()
      }
    }))
  };
});

describe('responsesAgent retry integration', () => {
  it('should retry OpenAI API call on timeout and eventually succeed', async () => {
    const openai = require('openai');
    let callCount = 0;
    openai.OpenAI.mockImplementation(() => ({
      responses: {
        create: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount < 2) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
          return Promise.resolve({ text: 'ok', response: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        })
      }
    }));
    // Patch the agent to use the new OpenAI mock
    const agent = new openai.OpenAI();
    const result = await retryWithBackoff(() => agent.responses.create({}), { retries: 2, initialDelay: 10, maxDelay: 20 });
    expect(result.text).toBe('ok');
    expect(callCount).toBe(2);
  });
});
