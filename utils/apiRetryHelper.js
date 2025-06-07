/**
 * Utility function to retry async operations with exponential backoff.
 * 
 * This is specifically designed for OpenAI API calls that may fail transiently,
 * particularly with APIConnectionTimeoutError when using models like 'o1' that
 * may require longer processing times than the default timeout allows.
 * 
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.retries - Maximum number of retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms before first retry (default: 2000)
 * @param {number} options.maxDelay - Maximum delay between retries in ms (default: 15000)
 * @param {string} options.operationDescription - Description for logging (default: "OpenAI API call")
 * @returns {Promise<*>} - The result of the operation if successful
 * @throws {Error} - The last error encountered if all retries fail
 */
async function retryWithBackoff(operation, {
  retries = 3,
  initialDelay = 2000,
  maxDelay = 15000,
  operationDescription = "OpenAI API call",
  timeout = parseInt(process.env.OPENAI_TIMEOUT_MS) || 60000, // Get timeout from env or use default
  timeoutIncrement = 60000 // Increase timeout by 60s per retry by default
} = {}) {
  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    // Calculate timeout for this attempt
    const currentTimeout = timeout + (timeoutIncrement * attempt);
    console.log(`[RETRY/BACKOFF] Executing Attempt ${attempt + 1}/${retries + 1} with t/o of ${currentTimeout}ms: ${operationDescription}`);
    try {
      // Pass currentTimeout to the operation if it accepts an argument
      const result = await operation(currentTimeout);
      if (attempt > 0) {
        // If we had previous attempts, log that we succeeded after retries
        console.log(`[RETRY/BACKOFF] ${operationDescription} succeeded after ${attempt} retries (t/o: ${currentTimeout}ms)`);
      }
      return result;
    } catch (error) {
      attempt++;
      lastError = error;
      if (attempt > retries) {
        console.error(`[RETRY/BACKOFF] ${operationDescription} failed after ${retries} retries (t/o: ${currentTimeout}ms):`, error);
        throw error;
      }
      const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      console.error(`[RETRY/BACKOFF] ${operationDescription} failed. Executing Attempt ${attempt + 1}/${retries + 1} with t/o of ${currentTimeout}ms after ${delay}ms delay.`,
        error.message || error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = {
  retryWithBackoff
};
