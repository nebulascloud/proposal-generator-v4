// tests/apiRetryHelper.test.js
const { retryWithBackoff } = require('../utils/apiRetryHelper');

describe('retryWithBackoff', () => {
  it('resolves immediately if fn succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await retryWithBackoff((timeout) => fn(timeout), { retries: 2, initialDelay: 10, maxDelay: 20 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempts = 0;
    const fn = jest.fn().mockImplementation((timeout) => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      return Promise.resolve('ok');
    });
    const result = await retryWithBackoff((timeout) => fn(timeout), { retries: 3, initialDelay: 10, maxDelay: 20 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after all retries fail', async () => {
    const fn = jest.fn().mockImplementation((timeout) => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    });
    await expect(retryWithBackoff((timeout) => fn(timeout), { retries: 2, initialDelay: 10, maxDelay: 20 })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-retryable error', async () => {
    const fn = jest.fn().mockImplementation((timeout) => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });
    await expect(retryWithBackoff((timeout) => fn(timeout), { retries: 2, initialDelay: 10, maxDelay: 20 })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
