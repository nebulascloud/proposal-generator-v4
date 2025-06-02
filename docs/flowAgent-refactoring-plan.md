# Refactoring Plan: `flowAgent.js`

**Date:** 2025-05-28

**Overall Goal:** To significantly simplify the `runFullFlow` function within `flowAgent.js`, improve its modularity, reduce lines of code, enhance readability, and promote better maintainability by breaking it down into smaller, single-responsibility helper functions. This will also involve addressing anti-patterns like overly accommodative error handling by fixing root causes where possible.

**Current State:**
*   `runFullFlow` is a very large function (over 3500 lines originally, currently being reduced).
*   It handles multiple distinct phases of the proposal generation lifecycle.
*   Variable scope and data flow are complex due to the function's size.
*   Error handling and status updates are dispersed throughout the function.

**Refactoring Strategy:**
The primary strategy is to decompose `runFullFlow` into a series of `async` helper functions. Each helper function will correspond to a logical phase or sub-phase of the proposal generation process. The main `runFullFlow` function will then act as an orchestrator, calling these helper functions in sequence and managing the data flow between them.

**Key Principles:**
*   **Single Responsibility:** Each new helper function should have a clear and single responsibility.
*   **Clear Inputs/Outputs:** Functions should take only necessary inputs and return well-defined outputs.
*   **Improved Error Handling:** Errors should be handled closer to their source, and session statuses updated consistently. Aim to fix root causes of errors rather than just patching over them.
*   **State Management:** Minimize shared state. Data should primarily flow via function arguments and return values.
*   **Readability:** Smaller functions with clear names will improve overall code readability.

## Target File Structure

To enhance modularity and maintainability, the logic currently in `flowAgent.js` will be distributed across several new files within a new `agents/flowSteps/` directory. The original `flowAgent.js` will be replaced by `flowAgentOrchestrator.js` which will primarily serve as an orchestrator.

```
agents/
├── flowAgentOrchestrator.js   // Main orchestrator, imports and calls functions from flowSteps
├── flowSteps/
│   ├── phase0_initializeFlow.js // Phase 0: Initialization
│   ├── phase1_briefProcessing.js // Contains analyzeBrief, assignProposalSections
│   ├── phase1_questionGeneration.js // Contains generateSpecialistQuestions, organizeAllQuestions
│   ├── phase2_customerInteraction.js // Contains conductCustomerQA
│   ├── phase2_drafting.js        // Contains draftProposalSections
│   ├── phase3_review.js          // Contains reviewProposalSections, conductPostInternalReviewCustomerQA
│   ├── phase3_revision.js        // Contains reviseProposalSections
│   ├── phase4_finalization.js    // Contains getFinalApproval, assembleFinalProposal
│   └── flowUtilities.js         // Shared helper functions (logResponseDetails, parseJson, etc.)
└── ... (other existing agent files)
```

**Rationale:**
*   **Per Phase/Major Sub-Phase:** Grouping closely related sub-phases (like brief analysis and section assignment) into a single file for that part of the phase (e.g., `phase1_briefProcessing.js`) keeps related logic together while still breaking down the overall flow.
*   **Clear Naming:** File names clearly indicate their purpose.
*   **`flowUtilities.js`:** Centralizes common helper functions, promoting DRY (Don't Repeat Yourself).
*   **Orchestration:** `flowAgentOrchestrator.js` becomes the main orchestrator that imports and calls functions from these new modules.

## Dependencies

The refactored flow logic within the `agents/flowSteps/` directory and the orchestrator (`flowAgentOrchestrator.js`) will have dependencies on several existing modules and potentially new shared utilities. Key dependencies include:

*   `../responsesAgent.js` (for interacting with the responses/AI agent)
*   `../../templates/defaultTemplate.js` (for the proposal structure template)
*   `../../db/models/session.js` (for database interactions with the `Session` model)
*   `../assistantDefinitions.js` (for definitions of specialist assistants)
*   `./flowSteps/flowUtilities.js` (for shared utility functions within the flow steps, once created)
*   `global.flowJobs` (for updating job status, managed by the orchestrator or passed as a dependency)
*   Node.js built-in modules (e.g., `fs`, `path`) as needed.

## Assessment of `responsesAgent.js`

`responsesAgent.js` plays a crucial role in the current system by managing:
*   **AI Interactions:** Encapsulating the logic for making calls to various AI models/assistants.
*   **File Management:** Handling the creation, uploading, and potentially retrieval of files associated with AI responses (e.g., analysis documents, drafted sections, answers).
*   **Token Tracking:** Monitoring and logging token usage for AI calls.
*   **Progress Updates:** Providing intermediate progress updates related to AI interactions.

For the current refactoring effort focused on `flowAgent.js` (becoming `flowAgentOrchestrator.js`), the strategy is to **continue using `responsesAgent.js` as is**. The new helper functions within `agents/flowSteps/` will call `responsesAgent.js` for these services.

**Future Considerations for `responsesAgent.js`:**
While `responsesAgent.js` is not the primary focus of *this* refactoring initiative, it is a significant component with its own complexities. Once the `flowAgentOrchestrator.js` refactoring is mature and stable, a separate review and potential refactoring of `responsesAgent.js` would be beneficial. Areas to consider for `responsesAgent.js` could include:
*   **Modularity:** Breaking down its functions further if it has grown too large.
*   **Error Handling:** Enhancing its error handling and reporting mechanisms.
*   **Interface Clarity:** Improving the clarity and consistency of its public interface (the functions it exposes).
*   **Configuration:** Making AI model selection or other parameters more configurable.
*   **Testability:** Ensuring its components are easily testable in isolation.

This phased approach allows us to focus on modularizing the flow orchestration logic first, without expanding the scope to include a full refactor of `responsesAgent.js` simultaneously.

## Session Status Management

A new utility function, `updateSessionStatus(sessionId, status)`, will be added to `agents/flowSteps/flowUtilities.js`. This function will be responsible for updating the session\'s status in the database. Each phase and sub-phase helper function will call this utility at its beginning, successful completion, and in case of errors to reflect the statuses outlined in the "Session Status Progression" section.

## Session Status Progression

To provide clear visibility into the progress of a proposal generation job, the session status will be updated at the beginning and end of each phase and sub-phase. The following statuses are proposed:

### Phase 0: Initialization & Setup
- **`initializeFlow`**
    - `phase0_initialize_flow_started`
    - `phase0_initialize_flow_completed`

### Phase 1: Brief Processing & Question Generation
- **`analyzeBrief` (Sub-Phase 1.1)**
    - `phase1.1_analyze_brief_started`
    - `phase1.1_analyze_brief_completed`
- **`assignProposalSections` (Sub-Phase 1.2)**
    - `phase1.2_assign_proposal_sections_started`
    - `phase1.2_assign_proposal_sections_completed`
- **`generateSpecialistQuestions` (Sub-Phase 1.3)**
    - `phase1.3_generate_specialist_questions_started`
    - `phase1.3_generate_specialist_questions_completed`
- **`organizeAllQuestions` (Sub-Phase 1.4)**
    - `phase1.4_organize_all_questions_started`
    - `phase1.4_organize_all_questions_completed`

### Phase 2: Customer Interaction & Drafting
- **`conductCustomerQA` (Sub-Phase 2.1)**
    - `phase2.1_conduct_customer_qa_started`
    - `phase2.1_conduct_customer_qa_completed`
    - `phase2.1_conduct_customer_qa_skipped` (if no initial answers and no questions to ask)
- **`draftProposalSections` (Sub-Phase 2.2)**
    - `phase2.2_draft_proposal_sections_started`
    - `phase2.2_draft_proposal_sections_completed`

### Phase 3: Review & Revision
- **`reviewProposalSections` (Sub-Phase 3.1)**
    - `phase3.1_review_proposal_sections_started`
    - `phase3.1_review_proposal_sections_completed`
- **`conductPostInternalReviewCustomerQA` (Sub-Phase 3.2 - Optional)**
    - `phase3.2_conduct_post_internal_review_customer_qa_started`
    - `phase3.2_conduct_post_internal_review_customer_qa_completed`
    - `phase3.2_conduct_post_internal_review_customer_qa_skipped` (if no questions for customer)
- **`reviseProposalSections` (Sub-Phase 3.3)**
    - `phase3.3_revise_proposal_sections_started`
    - `phase3.3_revise_proposal_sections_completed`
    - `phase3.3_revise_proposal_sections_skipped` (if no revisions needed)

### Phase 4: Finalization & Assembly
- **`getFinalApproval` (Sub-Phase 4.1)**
    - `phase4.1_get_final_approval_started`
    - `phase4.1_get_final_approval_completed`
    - `phase4.1_get_final_approval_rejected` (if approval is denied, might need specific handling)
- **`assembleFinalProposal` (Sub-Phase 4.2)**
    - `phase4.2_assemble_final_proposal_started`
    - `phase4.2_assemble_final_proposal_completed` (This could also be considered `flow_completed`)

**Error Statuses:**
In addition to the above, generic error statuses should be considered for each step, using the format `phaseX.Y_action_failed` or `phaseX_action_failed`. For example:
- `phase0_initialize_flow_failed`
- `phase1.1_analyze_brief_failed`
- `phase1.2_assign_proposal_sections_failed`
- `phase1.3_generate_specialist_questions_failed`
- `phase1.4_organize_all_questions_failed`
- `phase2.1_conduct_customer_qa_failed`
- `phase2.2_draft_proposal_sections_failed`
- `phase3.1_review_proposal_sections_failed`
- `phase3.2_conduct_post_internal_review_customer_qa_failed`
- `phase3.3_revise_proposal_sections_failed`
- `phase4.1_get_final_approval_failed`
- `phase4.2_assemble_final_proposal_failed`
This allows tracking the exact point of failure.

## Refactoring Steps:

The `runFullFlow` function will be broken down as follows. Each major step in the original function will be extracted into its own helper.

### Phase 0: Initialization & Setup
- **Function:** `async function initializeFlow(brief, initialCustomerReviewAnswers, jobId)`
- **Target File:** `agents/flowSteps/phase0_initializeFlow.js`
- **Responsibility:**
    - **Call `updateSessionStatus(sessionId, 'phase0_initialize_flow_started')` (Note: `sessionId` is created within this function, so this call will be right after its creation).**
    - Generate `currentProposalId`.
    - Reset `responsesAgent` progress.
    - Log initial inputs (`initialCustomerReviewAnswers`).
    - Associate `jobId` with `currentProposalId` in `global.flowJobs`.
    - Create and store a new `Session` in the database, obtaining `sessionId`.
    - Initialize `sections` from `defaultTemplate`.
    - Upload the initial `brief` and get `briefContextId` (assuming briefs are logged as context).
    - **Call `updateSessionStatus(sessionId, 'phase0_initialize_flow_completed')` before returning.**
    - Handle errors during this setup phase:
        - **If `sessionId` is available, call `updateSessionStatus(sessionId, 'phase0_initialize_flow_failed')`.**
        - Update job status accordingly.
- **Inputs:** `brief`, `initialCustomerReviewAnswers`, `jobId`
- **Outputs:** `{ currentProposalId, sessionId, sections, briefFileId, initialCustomerReviewAnswers }` (note: `initialCustomerReviewAnswers` is returned because it might be type-converted).
- **Status:**
    - [ ] `initializeFlow` function defined (currently in `flowAgent.js`, will be moved to `agents/flowSteps/phase0_initializeFlow.js`).
    - [ ] `runFullFlow` updated to call `initializeFlow` (orchestration will be updated once `initializeFlow` is moved and imported).

### Phase 1: Brief Processing & Question Generation

1.  **Sub-Phase 1.1: Brief Analysis**
    - **Function:** `async function analyzeBrief(currentProposalId, sessionId, briefContextId)`
    - **Target File:** `agents/flowSteps/phase1_briefProcessing.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase1.1_analyze_brief_started')`.**
        - Log start of phase and update job status.
        - Generate `analysisPrompt`.
        - Call `responsesAgent` for brief analysis.
        - Track token usage.
        - Log the analysis as a message/context in the database.
        - Store the resulting `analysisContextId`.
        - **Call `updateSessionStatus(sessionId, 'phase1.1_analyze_brief_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase1.1_analyze_brief_failed')`.**
            - Update session status (legacy, to be removed if redundant with the utility).
    - **Inputs:** `currentProposalId`, `sessionId`, `briefContextId`
    - **Outputs:** `{ analysisContextId, analysisResponseId }` (where `analysisResponseId` is the AI response id for chaining)
    - **Status:**
        - [ ] `analyzeBrief` function defined (in its target file: `agents/flowSteps/phase1_briefProcessing.js`).
        - [ ] `runFullFlow` updated to call `analyzeBrief` (orchestration will be updated once `analyzeBrief` is moved and imported).

2.  **Sub-Phase 1.2: Section Assignments**
    - **Function:** `async function assignProposalSections(currentProposalId, sessionId, briefContextId, analysisContextId, sections, analysisResponseId)`
    - **Target File:** `agents/flowSteps/phase1_briefProcessing.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_started')`.**
        - Log start of phase and update job status.
        - Determine `availableRoles`.
        - Generate `assignPrompt`.
        - Call `responsesAgent` for section assignments, chaining from `analysisResponseId`.
        - Parse the `assignments` JSON from the response.
        - Track token usage.
        - Log assignments as a context/message in the database.
        - Store the resulting `assignmentsContextId`.
        - **Call `updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_failed')`.**
            - Update session status (legacy, to be removed if redundant with the utility).
    - **Inputs:** `currentProposalId`, `sessionId`, `briefContextId`, `analysisContextId`, `sections`, `analysisResponseId`
    - **Outputs:** `{ assignments, assignmentsContextId, assignResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_briefProcessing.js`).
        - [ ] `runFullFlow` updated to call this function.

3.  **Sub-Phase 1.3: Specialist Question Generation**
    - **Function:** `async function generateSpecialistQuestions(currentProposalId, sessionId, briefContextId, analysisContextId, specialistRoles, assignResponseId)`
    - **Target File:** `agents/flowSteps/phase1_questionGeneration.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_started')`.**
        - Log start of phase and update job status.
        - Iterate through `specialistRoles` to generate questions.
        - For each role:
            - Create `questionPrompt`.
            - Call `responsesAgent`.
            - Parse JSON response to extract questions.
            - Add `role` to each question.
            - Log questions as context/message.
            - Store `questionsContextIds`.
        - Aggregate questions into `allQuestions`.
        - **Call `updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_failed')`.**
            - Update session status (legacy, to be removed if redundant with the utility).
    - **Inputs:** `currentProposalId`, `sessionId`, `briefContextId`, `analysisContextId`, `specialistRoles`, `assignResponseId`
    - **Outputs:** `{ allQuestions, questionsContextIds, lastQuestionResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_questionGeneration.js`).
        - [ ] `runFullFlow` updated to call this function.

4.  **Sub-Phase 1.4: Question Organization & Deduplication**
    - **Function:** `async function organizeAllQuestions(currentProposalId, sessionId, briefContextId, analysisContextId, allQuestions, lastQuestionResponseId)`
    - **Target File:** `agents/flowSteps/phase1_questionGeneration.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_started')`.**
        - Log start of phase and update job status.
        - Generate `dedupePrompt` using `allQuestions`.
        - Call `responsesAgent` for question organization, chaining from `lastQuestionResponseId`.
        - Parse `organizedQuestions` JSON.
        - Perform sanity checks.
        - Track token usage.
        - Log organized questions as a context/message.
        - Store `organizedQuestionsContextId`.
        - **Call `updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_failed')`.**
            - Update session status (legacy, to be removed if redundant with the utility).
    - **Inputs:** `currentProposalId`, `sessionId`, `briefContextId`, `analysisContextId`, `allQuestions`, `lastQuestionResponseId`
    - **Outputs:** `{ organizedQuestions, organizedQuestionsContextId, organizedQuestionsResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_questionGeneration.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 2: Customer Interaction & Drafting

1.  **Sub-Phase 2.1: Customer Q&A**
    - **Function:** `async function conductCustomerQA(currentProposalId, sessionId, briefContextId, questionsContextId, organizedQuestions, initialCustomerAnswers, organizedQuestionsResponseId)`
    - **Target File:** `agents/flowSteps/phase2_customerInteraction.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase2.1_conduct_customer_qa_started')`.**
        - Log start of phase and update job status.
        - If `initialCustomerAnswers` (answers provided directly to this phase) are available:
            - Log them as a context/message in the database (not as a file).
            - Set `customerAnswersResponse = { id: customerAnswersContextId }`.
            - Store `customerAnswers` (which would be `customerProvidedAnswers`).
        - Else (no answers provided for this phase, so generate them):
            - Generate `customerPrompt` from `organizedQuestions`.
            - Call `safeCreateResponse` (e.g., `CustomerInteractionAgent`) to get answers, chaining from `organizedQuestionsResponseId`.
            - Process `qaAgentResponse`:
                - Set `customerAnswersResponse`.
                - Store `customerAnswers`.
                - Log answers as a context/message in the database (not as a file).
                - Set `customerAnswersContextId`.
        - Ensure `customerAnswersResponse` is an object with an `id`.
        - **Call `updateSessionStatus(sessionId, 'phase2.1_conduct_customer_qa_completed')` (or `phase2.1_conduct_customer_qa_skipped` if applicable) before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase2.1_conduct_customer_qa_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `briefContextId`, `questionsContextId`, `organizedQuestions`, `initialCustomerAnswers` (optional), `organizedQuestionsResponseId`
    - **Outputs:** `{ customerAnswers, customerAnswersResponse, customerAnswersContextId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase2_customerInteraction.js`).
        - [ ] `runFullFlow` updated to call this function.


2.  **Sub-Phase 2.2: Section Drafting**
    - **Function:** `async function draftProposalSections(currentProposalId, sessionId, sections, assignments, briefContextId, analysisContextId, questionsContextId, customerAnswersContextId)`
    - **Target File:** `agents/flowSteps/phase2_drafting.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase2.2_draft_proposal_sections_started')`.**
        - Log start of phase and update job status.
        - Iterate through `sections` to draft each one in parallel (or sequentially if dependencies exist).
        - For each section:
            - Determine the assigned `role` from `assignments`.
            - Create `draftPrompt`.
            - Define `draftContexts` (including `briefContextId`, `analysisContextId`, `questionsContextId`, `customerAnswersContextId`, etc.).
            - Call `safeCreateResponse` for section drafting, chaining from `customerAnswersContextId` (or the last relevant response).
            - Store `draftContent`.
            - Track token usage.
            - Log draft as a context/message in the database (not as a file).
            - Store `draftContextIds` in a map.
        - **Call `updateSessionStatus(sessionId, 'phase2.2_draft_proposal_sections_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase2.2_draft_proposal_sections_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `briefContextId`, `analysisContextId`, `questionsContextId`, `customerAnswersContextId`
    - **Outputs:** `{ draftContextIds, lastDraftResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase2_drafting.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 3: Review & Revision

1.  **Sub-Phase 3.1: Section Review (Internal)**
    - **Function:** `async function reviewProposalSections(currentProposalId, sessionId, sections, assignments, sectionContexts, briefContextId, analysisContextId, lastDraftContextId)`
    - **Target File:** `agents/flowSteps/phase3_review.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase3.1_review_proposal_sections_started')`.**
        - Log start of phase and update job/session status.
        - Iterate through `sections` for review.
        - For each section:
            - Determine `reviewerRole` (e.g., Quality Manager or a different specialist).
            - Create `reviewPrompt`.
            - Define `reviewContexts` (draft context, brief, analysis, etc. — all referenced by context IDs or direct DB records, not files).
            - Call `safeCreateResponse` for review, chaining from `lastDraftContextId` or individual draft context IDs.
            - Store `reviewFeedback` as a message/context in the database (using the context model), including all relevant metadata (jobId, phase, section, reviewer, etc.).
            - Track token usage.
            - Log review context IDs in a `reviewContextIds` map (not file IDs).
        - **Call `updateSessionStatus(sessionId, 'phase3.1_review_proposal_sections_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase3.1_review_proposal_sections_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `sectionContexts`, `briefContextId`, `analysisContextId`, `lastDraftContextId`
    - **Outputs:** `{ reviewContextIds, lastReviewContextId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase3_review.js`).
        - [ ] `runFullFlow` updated to call this function.

2.  **Sub-Phase 3.2: Customer Q&A Post-Internal Review (Optional)**
    - **Function:** `async function conductPostInternalReviewCustomerQA(currentProposalId, sessionId, reviewFileIds, sectionFileIds, briefFileId, lastReviewResponseId)`
    - **Target File:** `agents/flowSteps/phase3_review.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase3.2_conduct_post_internal_review_customer_qa_started')`.**
        1.  Log start of phase and update job/session status.
        2.  **Extract Potential Questions from Internal Reviews:**
            *   Iterate through `reviewFileIds` (and their corresponding feedback content from Sub-Phase 3.1).
            *   Identify any questions explicitly raised for the customer during internal reviews. This might involve parsing review texts or looking for specific markers/structures indicating a question for the customer.
        3.  **Consolidate & Deduplicate Questions (if any):**
            *   If questions were extracted:
                *   Aggregate all identified questions.
                *   Generate a prompt for a "CollaborationAgent" (or a similar specialized agent) to consolidate, clarify, and deduplicate these questions into a final set for the customer.
                *   Call `safeCreateResponse` with this prompt, potentially chaining from `lastReviewResponseId` or another relevant response ID.
                *   Parse the agent's response to get `finalCustomerReviewQuestions`.
                *   If `finalCustomerReviewQuestions` is empty after deduplication (e.g., all questions were redundant or resolved), proceed as if no questions were found.
        4.  **Conduct Customer Q&A (if `finalCustomerReviewQuestions` exist and are non-empty):**
            *   Log the final set of customer review questions as a context/message in the database (not as a file).
            *   Generate `customerReviewPrompt` using `finalCustomerReviewQuestions`.
            *   Call `safeCreateResponse` (e.g., using a `CustomerInteractionAgent`) to present these questions to the customer and obtain their answers.
            *   Process the agent's response:
                *   Extract and store `customerReviewAnswers`.
                *   Log customer review answers as a context/message in the database (not as a file).
                *   Store `customerReviewResponseId` (from the agent's response, for chaining or logging).
            *   Track token usage for these interactions.
        5.  **Handle No Questions Scenario:**
            *   If no questions were extracted from internal reviews initially, or if `finalCustomerReviewQuestions` is empty after the consolidation/deduplication step, log this outcome.
            *   In this case, direct customer interaction for Q&A is skipped for this sub-phase. Outputs related to Q&A (e.g., `customerReviewQuestionsFileId`, `customerReviewAnswersFileId`) will be null or not set.
        - **Call `updateSessionStatus(sessionId, 'phase3.2_conduct_post_internal_review_customer_qa_completed')` (or `phase3.2_conduct_post_internal_review_customer_qa_skipped` if applicable) before returning.**
        6.  Handle errors throughout the process (e.g., during question extraction, agent calls, file uploads) and update session status accordingly:
            - **Call `updateSessionStatus(sessionId, 'phase3.2_conduct_post_internal_review_customer_qa_failed')`.**
    - **Inputs:**
        *   `currentProposalId`, `sessionId` (standard identifiers)
        *   `reviewFileIds` (essential for accessing internal review feedback from Sub-Phase 3.1, which may contain questions for the customer)
        *   `sectionFileIds` (may provide context for the CollaborationAgent or CustomerInteractionAgent when formulating/presenting questions or processing answers)
        *   `briefFileId` (general context for all AI interactions)
        *   `lastReviewResponseId` (or the ID of the last relevant AI interaction, for chaining calls to the CollaborationAgent and CustomerInteractionAgent)
    - **Outputs:** (All optional, depending on whether Q&A was performed)
        *   `customerReviewQuestionsFileId` (ID of the file containing the questions asked to the customer)
        *   `customerReviewAnswersFileId` (ID of the file containing the customer's answers)
        *   `customerReviewResponseId` (ID of the AI response from the customer interaction)
        *   A status or flag indicating whether customer Q&A was actually performed in this sub-phase.
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase3_review.js`).
        - [ ] `runFullFlow` updated to call this function.

3.  **Sub-Phase 3.3: Section Revision (Post-Review)**
    - **Function:** `async function reviseProposalSections(currentProposalId, sessionId, sections, assignments, sectionFileIds, reviewFileIds, customerReviewAnswersFileId, briefFileId, customerReviewResponseIdOrLastInternalReviewId)`
    - **Target File:** `agents/flowSteps/phase3_revision.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase3.3_revise_proposal_sections_started')`.**
        - Log start of phase and update job/session status.
        - Iterate through sections needing revision (based on internal and/or customer reviews).
        - For each section:
            - Determine assigned `role` for revision.
            - Create `revisionPrompt` including original draft, review feedback.
            - Define `revisionContexts`.
            - Call `safeCreateResponse` for revision, chaining appropriately.
            - Store `revisedContent`.
            - Track token usage.
            - Log revised section as a context/message in the database (not as a file).
            - Store in `revisedSectionFileIds` map.
        - **Call `updateSessionStatus(sessionId, 'phase3.3_revise_proposal_sections_completed')` (or `phase3.3_revise_proposal_sections_skipped` if applicable) before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase3.3_revise_proposal_sections_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `sectionFileIds`, `reviewFileIds`, `customerReviewAnswersFileId` (optional), `briefFileId`, `customerReviewResponseIdOrLastInternalReviewId`
    - **Outputs:** `{ revisedSectionFileIds, lastRevisionResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase3_revision.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 4: Finalization & Assembly

1.  **Sub-Phase 4.1: Get Final Approval**
    - **Function:** `async function getFinalApproval(currentProposalId, sessionId, /* other relevant inputs */)`
    - **Target File:** `agents/flowSteps/phase4_finalization.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase4.1_get_final_approval_started')`.**
        - Log start of phase and update job/session status.
        - Create `approvalPrompt` (e.g., for a "sp_Director" role).
        - Define `approvalContexts` (all final/revised section files).
        - Call `safeCreateResponse` for final approval, chaining.
        - Store `approvalDecision`.
        - Track token usage.
        - Log approval decision as a context/message in the database (not as a file).
        - Store in `finalApprovalContextId`.
        - **Call `updateSessionStatus(sessionId, 'phase4.1_get_final_approval_completed')` (or `phase4.1_get_final_approval_rejected`) before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase4.1_get_final_approval_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `finalProposalContextId` (or similar, representing the content to be approved)
    - **Outputs:** `{ finalApprovalContextId, finalApprovalResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase4_finalization.js`).
        - [ ] `runFullFlow` updated to call `getFinalApproval`

2.  **Sub-Phase 4.2: Assemble Final Proposal**
    - **Function:** `async function assembleFinalProposal(currentProposalId, sessionId, /* other relevant inputs */)`
    - **Target File:** `agents/flowSteps/phase4_finalization.js`
    - **Responsibility:**
        - **Call `updateSessionStatus(sessionId, 'phase4.2_assemble_final_proposal_started')`.**
        - Log start of phase and update job/session status.
        - Create `assemblyPrompt` for the final proposal.
        - Define `assemblyContexts` (all final section files, brief, approval).
        - Call `safeCreateResponse` for proposal assembly, chaining from `finalApprovalContextId`.
        - Store `finalProposalContent`.
        - Track token usage.
        - Log final proposal as a context/message in the database (not as a file).
        - Store in `finalProposalContextId`.
        - **Call `updateSessionStatus(sessionId, 'phase4.2_assemble_final_proposal_completed')` before returning.**
        - Handle errors:
            - **Call `updateSessionStatus(sessionId, 'phase4.2_assemble_final_proposal_failed')`.**
    - **Inputs:** `currentProposalId`, `sessionId`, `approvedProposalContexts` (or similar)
    - **Outputs:** `{ finalProposalContextId, finalProposalResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase4_finalization.js`).
        - [ ] `runFullFlow` updated to call `assembleFinalProposal`

---

## Consolidated Refactoring Task List

**I. Setup & Orchestrator Shell:**
- [x] Create new directory: `agents/flowSteps/`
- [x] Create `agents/flowAgentOrchestrator.js` (this will replace the old `flowAgent.js`)
- [x] Create `agents/flowSteps/flowUtilities.js`

**II. Phase 0: Initialization & Setup**
- [x] Define and implement `initializeFlow` in `agents/flowSteps/phase0_initializeFlow.js`
- [x] Integrate `initializeFlow` call into `flowAgentOrchestrator.js`

**III. Phase 1: Brief Processing & Question Generation**
- **Sub-Phase 1.1: Brief Analysis**
    - [ ] Define and implement `analyzeBrief` in `agents/flowSteps/phase1_briefProcessing.js`
    - [ ] Integrate `analyzeBrief` call into `flowAgentOrchestrator.js`
- **Sub-Phase 1.2: Section Assignments**
    - [ ] Define and implement `assignProposalSections` in `agents/flowSteps/phase1_briefProcessing.js`
    - [ ] Integrate `assignProposalSections` call into `flowAgentOrchestrator.js`
- **Sub-Phase 1.3: Specialist Question Generation**
    - [ ] Define and implement `generateSpecialistQuestions` in `agents/flowSteps/phase1_questionGeneration.js`
    - [ ] Integrate `generateSpecialistQuestions` call into `flowAgentOrchestrator.js`
- **Sub-Phase 1.4: Question Organization & Deduplication**
    - [ ] Define and implement `organizeAllQuestions` in `agents/flowSteps/phase1_questionGeneration.js`
    - [ ] Integrate `organizeAllQuestions` call into `flowAgentOrchestrator.js`

**IV. Phase 2: Customer Interaction & Drafting**
- **Sub-Phase 2.1: Customer Q&A**
    - [ ] Define and implement `conductCustomerQA` in `agents/flowSteps/phase2_customerInteraction.js`
    - [ ] Integrate `conductCustomerQA` call into `flowAgentOrchestrator.js`
- **Sub-Phase 2.2: Section Drafting**
    - [ ] Define and implement `draftProposalSections` in `agents/flowSteps/phase2_drafting.js`
    - [ ] Integrate `draftProposalSections` call into `flowAgentOrchestrator.js`

**V. Phase 3: Review & Revision**
- **Sub-Phase 3.1: Section Review (Internal)**
    - [ ] Define and implement `reviewProposalSections` in `agents/flowSteps/phase3_review.js`
    - [ ] Integrate `reviewProposalSections` call into `flowAgentOrchestrator.js`
- **Sub-Phase 3.2: Customer Q&A Post-Internal Review (Optional)**
    - [ ] Define and implement `conductPostInternalReviewCustomerQA` in `agents/flowSteps/phase3_review.js`
    - [ ] Integrate `conductPostInternalReviewCustomerQA` call into `flowAgentOrchestrator.js`
- **Sub-Phase 3.3: Section Revision (Post-Review)**
    - [ ] Define and implement `reviseProposalSections` in `agents/flowSteps/phase3_revision.js`
    - [ ] Integrate `reviseProposalSections` call into `flowAgentOrchestrator.js`

**VI. Phase 4: Finalization & Assembly**
- **Sub-Phase 4.1: Final Approval**
    - [ ] Define and implement `getFinalApproval` in `agents/flowSteps/phase4_finalization.js`
    - [ ] Integrate `getFinalApproval` call into `flowAgentOrchestrator.js`
- **Sub-Phase 4.2: Proposal Assembly & Manifest**
    - [ ] Define and implement `assembleFinalProposal` in `agents/flowSteps/phase4_finalization.js`
    - [ ] Integrate `assembleFinalProposal` call into `flowAgentOrchestrator.js`

**VII. Helper Utilities Migration & Refinement (to `agents/flowSteps/flowUtilities.js`)**
- [ ] Move and refine `logResponseDetails(response, operation)`
- [ ] Move and refine `convertOperationToPhase(operation)`
- [ ] Move and refine `safeCreateResponse(...)`
- [ ] Move and refine `parseJson(raw, label)`
- [ ] Move and refine `extractJsonFromText(text, label)`
- [ ] Move and refine `mockCustomerAnswer(...)`

**VIII. Main Orchestrator (`flowAgentOrchestrator.js`) Finalization**
- [ ] Ensure `runFullFlow` in `flowAgentOrchestrator.js` correctly calls all helper functions in sequence.
- [ ] Verify data (IDs, content) is passed correctly between helper functions via the orchestrator.
- [ ] Implement robust top-level `try...catch` block in `runFullFlow` for unhandled errors.
- [ ] Ensure overall session status is updated to `error` or `completed` appropriately.
- [ ] Ensure `runFullFlow` returns the final result (e.g., `finalProposalFileId`, `manifestFileId`).
- [ ] Address `updateFlowJobStatus(...)`: Confirm its location (orchestrator or utility) and ensure it's correctly used/passed as a dependency.

**IX. Testing & Documentation**
- [ ] Perform thorough testing after each significant phase/module integration.
- [ ] Write unit tests for each phase helper in `agents/flowSteps/`
- [ ] Write unit tests for the orchestrator in `agents/flowAgentOrchestrator.js`
- [ ] Update any relevant documentation to reflect the refactoring.
- [ ] Update this checklist as tasks are completed.
- [ ] Comment out legacy checklist items that are no longer relevant or will not be used in the future state (e.g., legacy orchestrator/agent code, deprecated helper functions, etc.)

**Progress Update (2025-05-29):**
- [x] Created new directory: `agents/flowSteps/`
- [x] Created `agents/flowAgentOrchestrator.js` (replacing old `flowAgent.js`)
- [x] Created `agents/flowSteps/flowUtilities.js`
- [x] Defined and implemented `initializeFlow` in `agents/flowSteps/phase0_initializeFlow.js` (Phase 0)
- [x] Integrated `initializeFlow` call into `flowAgentOrchestrator.js`
- [x] Exposed orchestrator as HTTP endpoint with Swagger docs and validation
- [x] Refactored Phase 0 to log the brief in the database (contexts table) using the context model, not file upload
- [x] Updated Phase 0 and orchestrator to require and propagate `jobId` robustly throughout the flow
- [x] Wrote and updated unit tests for Phase 0, ensuring 100% coverage and correct error handling
- [x] Confirmed endpoint and jobId propagation work end-to-end
- [x] Updated documentation and checklist as tasks are completed

**Lessons Learned & Application to Downstream Phases:**
- **Parameter Passing:** Always destructure and explicitly pass required parameters (e.g., `jobId`) through all orchestrator and phase helper calls to avoid undefined values and ensure traceability.
- **Database-centric Logging:** Prefer logging all key flow artifacts (e.g., brief, context, answers) in the database rather than file uploads for auditability and easier querying.
- **Unit Testing:** Update and align all unit tests with new data flow and error messages after each refactor. Mock new dependencies (e.g., context model) as needed.
- **Error Messages:** Standardize error messages for easier debugging and test maintenance. Update tests to match new error strings.
- **Swagger & API:** Ensure all new endpoints are documented and validated with Swagger/OpenAPI, and that jobId/status/result endpoints are consistent.
- **Checklist Discipline:** Mark each completed step in the checklist, and update the rationale/lessons for future phases.

**Next Steps:**
- Apply the above lessons to all downstream phases (Phase 1 and beyond):
  - Ensure all new phase helpers and orchestrator logic use explicit parameter passing and robust jobId propagation.
  - Migrate all file-based artifacts to database-centric storage where possible.
  - Write/maintain unit tests for each new phase, mocking new models/utilities as needed.
  - Keep documentation and this checklist up to date as each phase is completed.
