# API Timeout and Retry Strategy Plan

## 1. Problem Statement

Currently, the application experiences `APIConnectionTimeoutError` when using the `o1` reasoning model for tasks like organizing questions. The default timeout is set to 60 seconds, which is insufficient for some operations with this model. Additionally, the retry and backoff logic for API calls is implemented in specific parts of the code (e.g., `phase1_questionGeneration.js`), leading to code duplication and inconsistent error handling.

## 2. Goals

*   Resolve API timeouts when using models that require longer processing times.
*   Make the API timeout configurable via environment variables.
*   Centralize and standardize the retry and backoff logic for all OpenAI API calls in the new modular proposal generator flows.
*   Improve the overall robustness and maintainability of API interactions.

## 2.1. Scope Definition

### In Scope
* **New Modular Flows Only**: Primary focus on files in the `agents/flowSteps/` directory that are called by `flowAgentOrchestrator.js`.
* **OpenAI API Calls**: Focus on wrapping OpenAI API calls with the retry/backoff utility.
* **Consistent Logging**: Ensure all retry-related logging follows a standardized format.
* **Contract Enforcement**: Add documentation comments to relevant agent files for future compliance.

### Out of Scope
* **Legacy Flows Implementation**: Do NOT modify the implementation of legacy or assistants-based flows.
* **Other API Calls**: Do NOT modify non-OpenAI API calls.
* **Existing Logging**: Do NOT alter existing logging patterns for question collection or other functionalities.

### Clarification on Dependencies
* **Required Support Files**: Documentation comments can be added to files like `responsesAgent.js` to establish the contract that all OpenAI API calls should use the retry utility.
* **Future-proofing**: Comments in key dependencies like `responsesAgent.js` are allowed to enforce the contract for future development.
* **No Functional Changes**: No functional changes to files outside of the new modular flows, only documentation comments.

## 3. Impact Assessment

### Configurable API Timeout

*   **Benefits:**
    *   Allows users to adjust the timeout based on their chosen model and task complexity, preventing timeouts for longer-running requests.
    *   Increases the flexibility and robustness of the application across different OpenAI models.
    *   No code changes required to adjust the timeout once the environment variable is implemented.
*   **Drawbacks:**
    *   Requires modifying the API client initialization in `responsesAgent.js`.
    *   Needs clear documentation for the new environment variable.
    *   Setting an excessively high timeout could lead to longer waiting times for the user if the model is slow.

### Shared Retry/Backoff Utility

*   **Benefits:**
    *   Eliminates code duplication by having a single implementation for retry logic.
    *   Ensures consistent error handling and retry behavior across all API calls.
    *   Improves code maintainability and simplifies future updates to the retry strategy.
    *   Centralizes the logic for easier testing and debugging of API interaction issues.
*   **Drawbacks:**
    *   Requires refactoring existing retry logic in various parts of the codebase (e.g., `phase1_questionGeneration.js`).
    *   Requires modifying all functions that make direct API calls to use the new utility.
    *   Needs careful design to handle different types of API calls and potential error responses gracefully.

## 4. Proposed Plan

1.  **Create a new utility file:** Create a file `utils/apiRetryHelper.js` to contain the shared retry and backoff logic.
2.  **Implement Retry Logic Utility:** Develop a function within `apiRetryHelper.js` that takes an asynchronous function (the API call), the number of retry attempts, and a backoff strategy (e.g., exponential backoff) as parameters. This function will execute the API call and retry according to the specified parameters in case of transient errors (like timeouts).
3.  **Configure API Timeout:**
    *   Add a new environment variable, `OPENAI_TIMEOUT_MS`, to the `.env` file and document it.
    *   Modify `agents/responsesAgent.js` to read the `OPENAI_TIMEOUT_MS` environment variable.
    *   Update the `OpenAI` client initialization in `responsesAgent.js` to use the value from `OPENAI_TIMEOUT_MS` for the `timeout` option. Provide a reasonable default value if the environment variable is not set.
4.  **Refactor API Calls to Use Utility:**
    *   **Scope Limitation: Focus on the new modular flows**:
        *   Primary focus: Update files in `agents/flowSteps/` directory that are called by `flowAgentOrchestrator.js`.
        *   Do NOT modify the implementation of any legacy or assistants-based flows.
        *   Add documentation comments to dependency files like `responsesAgent.js` to establish the contract that all OpenAI API calls should use the retry utility.
    *   Identify all OpenAI API calls in the new modular flow files (specifically those in `agents/flowSteps/` called by `flowAgentOrchestrator.js`).
    *   Wrap these API calls within the new retry utility function from `apiRetryHelper.js`.
    *   Remove any specific retry logic currently implemented in `agents/flowSteps/phase1_questionGeneration.js`.
    *   Ensure that the refactored API calls correctly handle responses and errors.
    *   **Standardized Operation Descriptions**:
        *   All `retryWithBackoff` calls in new modular flows must use this standard format for operation descriptions:
        *   `OpenAI API - {operation} (proposalId: {id}, sessionId: {id})`
        *   Examples:
            *   `OpenAI API - Brief Analysis (proposalId: ${currentProposalId}, sessionId: ${sessionId})`
            *   `OpenAI API - Organize Questions (proposalId: ${currentProposalId}, sessionId: ${sessionId})`
            *   `OpenAI API - Specialist Questions (${role}, proposalId: ${currentProposalId}, sessionId: ${sessionId})`
        *   Do not use other formats like "Using retry/backoff for: [operation]" to ensure consistency.
    *   **Preserving Existing Logging**:
        *   Do NOT modify or remove existing logging for question collection counts.
        *   Only enhance the OpenAI API calls with the new retry utility without changing other functionality.
    *   **Specific API Calls to Update in New Modular Flows:**
        *   **In `phase1_briefProcessing.js`:**
            *   Brief Analysis call to `responsesAgent.createInitialResponse`
            *   Section Assignments call to `responsesAgent.createInitialResponse`
        *   **In `phase1_questionGeneration.js`:**
            *   Specialist Questions call to `responsesAgent.createInitialResponse`
            *   Organize Questions call to `responsesAgent.createInitialResponse`
5.  **Update Documentation:** Add documentation for the `OPENAI_TIMEOUT_MS` environment variable in the main `README.md` or a dedicated configuration guide.
6.  **Add/Update Tests:**
    *   Write unit tests for the new `utils/apiRetryHelper.js` to ensure the retry and backoff logic works as expected.
    *   Update existing unit tests in `agents/responsesAgent.test.js` and `agents/flowSteps/phase1_questionGeneration.test.js` to reflect the changes in API call handling and the removal of localized retry logic.

## 5. Next Steps

All planned tasks have been completed successfully:

1. ✓ Created a new `apiRetryHelper.js` utility with robust retry/backoff logic
2. ✓ Added configurable timeout via `OPENAI_TIMEOUT_MS` environment variable:
   - Added this variable to `.env.example` with a reasonable default value (120000 ms)
   - Updated `agents/responsesAgent.js` to use this variable for timeout configuration
   
3. ✓ Refactored all OpenAI API calls in the new modular flows to use the `retryWithBackoff` utility:
   - Brief Analysis in `phase1_briefProcessing.js`
   - Section Assignments in `phase1_briefProcessing.js`
   - Specialist Questions in `phase1_questionGeneration.js`
   - Organize Questions in `phase1_questionGeneration.js`
   
4. ✓ Added documentation:
   - Added documentation for the `OPENAI_TIMEOUT_MS` environment variable in the main `README.md`
   - Added a contract comment in `responsesAgent.js`
   
5. ✓ Updated unit tests:
   - Added mocks for `retryWithBackoff` in test files
   - Verified that all tests pass with the new changes
   
6. ✓ Performed a final audit:
   - Verified that all OpenAI API calls in the new modular flows use `retryWithBackoff`
   - Confirmed no API calls were missed

Implementation is now complete and ready for review.

### Implementation Checklist

1. **Required Files to Update**:
   * `utils/apiRetryHelper.js` - Create or update this file with the retry/backoff utility
   * `agents/flowSteps/phase1_briefProcessing.js` - Update OpenAI API calls with retryWithBackoff
   * `agents/flowSteps/phase1_questionGeneration.js` - Update OpenAI API calls with retryWithBackoff
   * `agents/responsesAgent.js` - Add documentation comment about using the retry utility for all OpenAI API calls

2. **Files NOT to Modify Functionally**:
   * Any legacy flow files (no functional changes)
   * `assistantAgent.js` and other components outside the new modular flows (no functional changes)

3. **Files to Add Documentation Comments Only**:
   * `agents/responsesAgent.js` - Add comments to establish the contract that all OpenAI API calls must use the retry utility
   * Other key dependency files where establishing the contract would be beneficial for future development

3. **Specific Implementation Details**:
   * In `phase1_briefProcessing.js`:
     * Identify all calls to `responsesAgent.createInitialResponse`
     * Wrap each call in `retryWithBackoff` with consistent operation description format
     * Use 3 retries, initial delay of 2000ms, and max delay of 15000ms
   * In `phase1_questionGeneration.js`:
     * Identify all calls to `responsesAgent.createInitialResponse`
     * Wrap each call in `retryWithBackoff` with consistent operation description format
     * Ensure existing question collection logging remains intact and unchanged
     * For specialist questions, use 3 retries, initial delay of 2000ms, and max delay of 15000ms
     * For organizing questions, use the same retry parameters as the original implementation

4. **Quality Assurance Checks**:
   * Verify consistent logging format in all `retryWithBackoff` calls
   * Confirm no changes to existing question collection logging
   * Run tests to verify functionality remains intact
   * Perform manual validation through test runs to observe retry behavior
   * Verify that no functional changes are made to files outside the specified scope
   * Check that the implementation aligns with the logs you shared, showing proper operation descriptions and retry behavior

5. **Key Lessons Learned from Log Analysis**:
   * Operation descriptions must be consistent in format and detail level
   * Logging for question collection must be preserved exactly as is
   * Retry/backoff should be consistently applied to all OpenAI API calls in the new modular flows
   * Avoid inconsistencies between messaging like "Using retry/backoff for: Organize Questions..." vs "Using retry/backoff for: OpenAI response creation..."

## 6. Future Enhancements (For Consideration)

* Implement dynamic timeout calculation based on estimated or actual token count of the input and/or previous response, with a generous buffer (e.g., x1.5 or x2). This would allow the system to automatically adjust the timeout for each API call, reducing the need for manual configuration. This enhancement would require:
    * Estimating token count before making the API call (using heuristics or a tokenizer library).
    * Defining a formula to translate token count to timeout duration.
    * Integrating this logic into the API call preparation step.
* Monitor and analyze actual API response times and error rates to further tune timeout and retry strategies.

---

## 7. Progress Tracking

- [x] Create `utils/apiRetryHelper.js` for shared retry and backoff logic
- [x] Implement retry logic utility function
- [x] Add `OPENAI_TIMEOUT_MS` to `.env` and document it
- [x] Update `agents/responsesAgent.js` to use the new timeout variable
- [x] Refactor OpenAI API calls in new modular flows to use the retry utility:
  - [x] Update `agents/flowSteps/phase1_briefProcessing.js` - Brief Analysis
  - [x] Update `agents/flowSteps/phase1_briefProcessing.js` - Section Assignments
  - [x] Update `agents/flowSteps/phase1_questionGeneration.js` - Specialist Questions
  - [x] Update `agents/flowSteps/phase1_questionGeneration.js` - Organize Questions
- [x] Add comment in `responsesAgent.js` enforcing the contract to use retry utility
- [x] Remove old retry logic from `phase1_questionGeneration.js`
- [x] Update documentation for timeout configuration
  - [x] Added `OPENAI_TIMEOUT_MS` to `.env.example` file
  - [x] Added documentation in main README.md
- [x] Add or update unit tests for retry utility and refactored API calls
  - [x] Added mocks for `retryWithBackoff` in `phase1_briefProcessing.test.js`
  - [x] Added mocks for `retryWithBackoff` in `flowAgentOrchestrator.test.js`
  - [x] Added mocks for `retryWithBackoff` in `parallelSequentialQuestions.test.js`
  - [x] Verified all tests pass
- [x] Final audit to confirm all OpenAI API calls in new modular flows use the retry utility
  - [x] Verified `phase0_initializeFlow.js` - No OpenAI API calls found
  - [x] Verified `flowUtilities.js` - No OpenAI API calls found
  - [x] Verified `flowPrompts.js` - No OpenAI API calls found
  - [x] Verified `phase1_briefProcessing.js` - All calls properly wrapped with retryWithBackoff
  - [x] Verified `phase1_questionGeneration.js` - All calls properly wrapped with retryWithBackoff

## 8. Implementation Execution Plan

1. **Preparation Phase**:
   - Document the current implementation to understand what needs to be changed
   - Identify all OpenAI API calls in the new modular flows
   - Create a backup branch if needed
   - Study the logs provided to understand the inconsistencies to avoid

2. **Implementation Phase**:
   - Update `agents/flowSteps/phase1_briefProcessing.js`:
     - Wrap OpenAI API calls in `retryWithBackoff`
     - Use standardized operation descriptions
   - Update `agents/flowSteps/phase1_questionGeneration.js`:
     - Wrap OpenAI API calls in `retryWithBackoff` where not already implemented
     - Use standardized operation descriptions
     - Preserve existing question collection logging
   - Add documentation comment to `agents/responsesAgent.js`:
     - Establish the contract that all OpenAI API calls should use the retry utility
     - No functional changes unless directly related to the retry mechanism

3. **Validation Phase**:
   - Run tests to ensure functionality
   - Verify consistent logging format across all operation descriptions
   - Check that question collection logging is preserved exactly
   - Confirm the log output matches the expected format shown in the logs
   - Perform a final audit of all changes

4. **Completion Phase**:
   - Update progress tracking in this document
   - Document any issues encountered and their resolutions
   - Create a summary of changes made
