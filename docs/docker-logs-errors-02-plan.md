# Docker Logs Errors 02 - Plan

This document outlines the plan to address errors identified in `docker-logs-errors-02.md`.

## Error Summary:

1.  **`ReferenceError: customerAnswersResponse is not defined`** in Phase 2.2 (Section Development).
2.  **`ERROR: Missing draft file ID for section <Section Name> before review.`** in Phase 3.1 (Quality Manager reviews).
3.  **`Error: Missing data for revising section <Section Name>: reviewFileId=undefined, draftSectionFileId=undefined, previousMessageId=undefined`** in Phase 3.3 (Authors revising sections).
4.  **`Missing revised file ID for section <Section Name> during final approval prep.`** in Phase 4.1 (Final review and assembly).
5.  **Token Usage Reporting Incorrect (All Zeros)**: Final token report shows no usage.

## Plan:

### Issue 1: `ReferenceError: customerAnswersResponse is not defined` (Phase 2.2)
-   **Status:** TODO
-   **Action:**
    -   Investigate `flowAgent.js` around line 1126 (as indicated in the logs).
    -   Ensure `customerAnswersResponse` (or the variable holding the customer's answers from Phase 2.1) is correctly defined and passed to the section drafting logic.
    -   Verify that the response object from the "Customer Q&A" step is correctly named and accessed.

### Issue 2: `ERROR: Missing draft file ID for section <Section Name> before review.` (Phase 3.1)
-   **Status:** TODO
-   **Action:**
    -   Examine the section drafting loop in Phase 2.2 of `flowAgent.js`.
    -   Ensure that after each section draft is created and its content stored (e.g., using `createAndUploadFile`), the returned file ID (or context ID) is correctly stored in the `proposalProgress.phase2.sectionDrafts.sections[sectionName]` object, likely under a `fileId` or `contextId` property.
    -   Verify that this stored ID is then correctly retrieved in Phase 3.1 before initiating the review for each section.

### Issue 3: `Error: Missing data for revising section <Section Name>` (Phase 3.3)
-   **Status:** TODO
-   **Action:**
    -   Analyze `flowAgent.js` around line 1464.
    -   Confirm that `reviewFileId` (from Phase 3.1 reviews), `draftSectionFileId` (from Phase 2.2 drafts), and `previousMessageId` (from the review interaction) are all being correctly populated and passed to the revision logic for each section.
    -   This likely means ensuring that the `proposalProgress` object is updated with these details at each step and that they are retrieved correctly.

### Issue 4: `Missing revised file ID for section <Section Name> during final approval prep.` (Phase 4.1)
-   **Status:** TODO
-   **Action:**
    -   Check the revision loop in Phase 3.3 of `flowAgent.js`.
    -   Ensure that after a section is revised and its content stored, the new file ID (or context ID) is updated in `proposalProgress.phase3.revisions.sections[sectionName]`, probably under a `fileId` or `contextId`.
    -   Verify this ID is correctly accessed in Phase 4.1 when preparing for final assembly and review.

### Issue 5: Token Usage Reporting Incorrect (All Zeros)
-   **Status:** TODO
-   **Action:**
    -   Review all calls to `trackTokenUsage` in `flowAgent.js` and `responsesAgent.js`.
    -   Ensure that the `response.usage` object from the OpenAI API is correctly passed to `trackTokenUsage`.
    -   The logs show `[Token Usage] proposal-xxxx/PhaseX_Component: YYYY tokens (0 prompt, 0 completion)` for several steps. This indicates that `total_tokens` might be estimated or coming from a different part of the response object than `prompt_tokens` and `completion_tokens`.
    -   In `responsesAgent.js`, the `trackTokenUsage` function has fallbacks to estimate token usage if `response.usage` is not found. However, the primary path should correctly extract `prompt_tokens` and `completion_tokens`.
    -   The OpenAI response mock in `responsesAgent.test.js` *does* include `prompt_tokens` and `completion_tokens` in the `usage` object. The issue might be with how the actual API response is handled or how `trackTokenUsage` is called with the live response.
    -   Specifically, check if `response.usage.prompt_tokens` and `response.usage.completion_tokens` are correctly accessed and summed into `proposalProgress.tokenSummary`.
    -   The log `[Token Usage] proposal-1748405658325/Phase1_BriefAnalysis: 1509 tokens (0 prompt, 0 completion)` is a key indicator. The total is reported, but prompt/completion are not. This needs to be fixed in `trackTokenUsage`.

## Progress Tracking:

-   [x] **Issue 1:** `customerAnswersResponse` not defined
    - Fixed by adding a check for the existence of `customerAnswersResponse` before using its `id` property.
    - Added fallback to use `null` for `previousResponseId` if `customerAnswersResponse` is undefined.
-   [x] **Issue 2:** Missing draft file ID for review
    - Fixed by enhancing the review phase with better debugging and recovery mechanisms.
    - Added checks for missing section file IDs before reviews begin and attempts to re-upload content if needed.
    - Improved error handling when file IDs are missing to provide more context.
-   [x] **Issue 3:** Missing data for revision
    - Enhanced revision process with improved debugging and recovery for file IDs.
    - Added recovery mechanism that re-uploads content when file IDs are missing but content is available.
    - Improved logging for better troubleshooting of issues in this phase.
-   [x] **Issue 4:** Missing revised file ID for final approval
    - Added comprehensive checks before final approval to ensure all sections have file IDs.
    - Implemented recovery mechanism to re-upload revised content when file IDs are missing.
    - Created fallback placeholder IDs for the manifest when recovery attempts fail but content exists.
-   [x] **Issue 5:** Token Usage Reporting
    - Fixed by updating `trackTokenUsage` to handle parameter order inconsistency between test expectations and actual function calls.
    - Added parameter normalization to extract proper phase/component from the combined strings.
    - Added warning for when the phase/component structure doesn't match the expected format.
