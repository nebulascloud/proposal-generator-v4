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

## Refactoring Steps:

The `runFullFlow` function will be broken down as follows. Each major step in the original function will be extracted into its own helper.

### Phase 0: Initialization & Setup
- **Function:** `async function initializeFlow(brief, initialCustomerReviewAnswers, jobId)`
- **Target File:** `agents/flowSteps/phase0_initializeFlow.js`
- **Responsibility:**
    - Generate `currentProposalId`.
    - Reset `responsesAgent` progress.
    - Log initial inputs (`initialCustomerReviewAnswers`).
    - Associate `jobId` with `currentProposalId` in `global.flowJobs`.
    - Create and store a new `Session` in the database, obtaining `sessionId`.
    - Initialize `sections` from `defaultTemplate`.
    - Upload the initial `brief` and get `briefFileId`.
    - Handle errors during this setup phase and update session status accordingly.
- **Inputs:** `brief`, `initialCustomerReviewAnswers`, `jobId`
- **Outputs:** `{ currentProposalId, sessionId, sections, briefFileId, initialCustomerReviewAnswers }` (note: `initialCustomerReviewAnswers` is returned because it might be type-converted).
- **Status:**
    - [ ] `initializeFlow` function defined (currently in `flowAgent.js`, will be moved to `agents/flowSteps/phase0_initializeFlow.js`).
    - [ ] `runFullFlow` updated to call `initializeFlow` (orchestration will be updated once `initializeFlow` is moved and imported).

### Phase 1: Brief Processing & Question Generation

1.  **Sub-Phase 1.1: Brief Analysis**
    - **Function:** `async function analyzeBrief(currentProposalId, sessionId, briefFileId)`
    - **Target File:** `agents/flowSteps/phase1_briefProcessing.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Generate `analysisPrompt`.
        - Call `safeCreateResponse` for brief analysis.
        - Track token usage.
        - Upload the `analysis` text and get `analysisFileId`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `briefFileId`
    - **Outputs:** `{ analysisFileId, analysisResponseId }` (where `analysisResponseId` is `analysisResponse.id` for chaining)
    - **Status:**
        - [ ] `analyzeBrief` function defined (currently in `flowAgent.js`, will be moved to `agents/flowSteps/phase1_briefProcessing.js`).
        - [ ] `runFullFlow` updated to call `analyzeBrief` (orchestration will be updated once `analyzeBrief` is moved and imported).

2.  **Sub-Phase 1.2: Section Assignments**
    - **Function:** `async function assignProposalSections(currentProposalId, sessionId, briefFileId, analysisFileId, sections, analysisResponseId)`
    - **Target File:** `agents/flowSteps/phase1_briefProcessing.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Determine `availableRoles`.
        - Generate `assignPrompt`.
        - Call `safeCreateResponse` for section assignments, chaining from `analysisResponseId`.
        - Parse the `assignments` JSON from the response.
        - Track token usage.
        - Upload `assignments` and get `assignmentsFileId`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `briefFileId`, `analysisFileId`, `sections`, `analysisResponseId`
    - **Outputs:** `{ assignments, assignmentsFileId, assignResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_briefProcessing.js`).
        - [ ] `runFullFlow` updated to call this function.

3.  **Sub-Phase 1.3: Specialist Question Generation**
    - **Function:** `async function generateSpecialistQuestions(currentProposalId, sessionId, briefFileId, specialistRoles, assignResponseId)`
    - **Target File:** `agents/flowSteps/phase1_questionGeneration.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Iterate through `specialistRoles` to generate questions in parallel.
        - For each role:
            - Create `questionPrompt`.
            - Call `safeCreateResponse` (potentially chaining if a global `lastQuestionResponseId` is maintained or passed iteratively).
            - Parse the specialist agent's JSON response string to extract structured questions (e.g., into a variable like `roleQuestions`).
            - Add `role` to each extracted question.
            - Store these questions in a temporary collection for this role.
        - Aggregate questions from all roles into `allQuestions`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `briefFileId`, `analysisFileId` (as context), `specialistRoles`, `assignResponseId` (or last relevant response ID for chaining)
    - **Outputs:** `{ allQuestions, lastQuestionResponseId }` (where `lastQuestionResponseId` is the ID of one of the question generation responses for chaining into organization)
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_questionGeneration.js`).
        - [ ] `runFullFlow` updated to call this function.

4.  **Sub-Phase 1.4: Question Organization & Deduplication**
    - **Function:** `async function organizeAllQuestions(currentProposalId, sessionId, briefFileId, analysisFileId, allQuestions, lastQuestionResponseId)`
    - **Target File:** `agents/flowSteps/phase1_questionGeneration.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Generate `dedupePrompt` using `allQuestions`.
        - Call `safeCreateResponse` for question organization, chaining from `lastQuestionResponseId`.
        - Parse `organizedQuestions` JSON.
        - Perform sanity checks and ensure expected structure.
        - Track token usage.
        - Upload `organizedQuestions` and get `questionsFileId`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `briefFileId`, `analysisFileId`, `allQuestions`, `lastQuestionResponseId`
    - **Outputs:** `{ organizedQuestions, questionsFileId, organizedQuestionsResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase1_questionGeneration.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 2: Customer Interaction & Drafting

1.  **Sub-Phase 2.1: Customer Q&A**
    - **Function:** `async function conductCustomerQA(currentProposalId, sessionId, briefFileId, questionsFileId, organizedQuestions, initialCustomerAnswers, organizedQuestionsResponseId)`
    - **Target File:** `agents/flowSteps/phase2_customerInteraction.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - If `initialCustomerAnswers` (answers provided directly to this phase) are available:
            - Upload them and get `answersFileId`.
            - Set `customerAnswersResponse = { id: answersFileId }`.
            - Store `customerAnswers` (which would be `customerProvidedAnswers`).
        - Else (no answers provided for this phase, so generate them):
            - Generate `customerPrompt` from `organizedQuestions`.
            - Call `safeCreateResponse` (e.g., `CustomerInteractionAgent`) to get answers, chaining from `organizedQuestionsResponseId`.
            - Process `qaAgentResponse`:
                - Set `customerAnswersResponse`.
                - Store `customerAnswers`.
                - If `qaAgentResponse.id` exists, set `answersFileId`.
                - Else, upload `customerAnswers` and set `answersFileId`, then update `customerAnswersResponse.id`.
        - Ensure `customerAnswersResponse` is an object with an `id`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `briefFileId`, `questionsFileId`, `organizedQuestions`, `initialCustomerAnswers` (optional, answers provided at the start of the flow), `organizedQuestionsResponseId`
    - **Outputs:** `{ customerAnswers, customerAnswersResponse, answersFileId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase2_customerInteraction.js`).
        - [ ] `runFullFlow` updated to call this function.


2.  **Sub-Phase 2.2: Section Drafting**
    - **Function:** `async function draftProposalSections(currentProposalId, sessionId, sections, assignments, briefFileId, analysisFileId, questionsFileId, answersFileId)`
    - **Target File:** `agents/flowSteps/phase2_drafting.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Iterate through `sections` to draft each one in parallel (or sequentially if dependencies exist).
        - For each section:
            - Determine the assigned `role` from `assignments`.
            - Create `draftPrompt`.
            - Define `draftContexts` (including `briefFileId`, `analysisFileId`, `questionsFileId`, `answersFileId`, etc.).
            - Call `safeCreateResponse` for section drafting, chaining from `answersFileId` (or the last relevant response).
            - Store `draftContent`.
            - Track token usage.
            - Upload draft and get `draftFileId`.
            - Store `draftFileId` in `sectionFileIds` map.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `briefFileId`, `analysisFileId`, `questionsFileId`, `answersFileId` (or `customerAnswersResponse.id`)
    - **Outputs:** `{ sectionFileIds, lastDraftResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase2_drafting.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 3: Review & Revision

1.  **Sub-Phase 3.1: Section Review (Internal)**
    - **Function:** `async function reviewProposalSections(currentProposalId, sessionId, sections, assignments, sectionFileIds, briefFileId, analysisFileId, lastDraftResponseId)`
    - **Target File:** `agents/flowSteps/phase3_review.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Iterate through `sections` for review.
        - For each section:
            - Determine `reviewerRole` (e.g., Quality Manager or a different specialist).
            - Create `reviewPrompt`.
            - Define `reviewContexts` (draft file, brief, analysis, etc.).
            - Call `safeCreateResponse` for review, chaining from `lastDraftResponseId` or individual draft response IDs.
            - Store `reviewFeedback`.
            - Track token usage.
            - Upload review and get `reviewFileId`.
            - Store `reviewFileId` in `reviewFileIds` map.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `sectionFileIds`, `briefFileId`, `analysisFileId`, `lastDraftResponseId`
    - **Outputs:** `{ reviewFileIds, lastReviewResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase3_review.js`).
        - [ ] `runFullFlow` updated to call this function.

2.  **Sub-Phase 3.2: Customer Q&A Post-Internal Review (Optional)**
    - **Function:** `async function conductPostInternalReviewCustomerQA(currentProposalId, sessionId, reviewFileIds, sectionFileIds, briefFileId, lastReviewResponseId)`
    - **Target File:** `agents/flowSteps/phase3_review.js`
    - **Responsibility:**
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
            *   Upload `finalCustomerReviewQuestions` to a file and get `customerReviewQuestionsFileId`.
            *   Generate `customerReviewPrompt` using `finalCustomerReviewQuestions`.
            *   Call `safeCreateResponse` (e.g., using a `CustomerInteractionAgent`) to present these questions to the customer and obtain their answers.
            *   Process the agent's response:
                *   Extract and store `customerReviewAnswers`.
                *   Upload `customerReviewAnswers` to a file and get `customerReviewAnswersFileId`.
                *   Store `customerReviewResponseId` (from the agent's response, for chaining or logging).
            *   Track token usage for these interactions.
        5.  **Handle No Questions Scenario:**
            *   If no questions were extracted from internal reviews initially, or if `finalCustomerReviewQuestions` is empty after the consolidation/deduplication step, log this outcome.
            *   In this case, direct customer interaction for Q&A is skipped for this sub-phase. Outputs related to Q&A (e.g., `customerReviewQuestionsFileId`, `customerReviewAnswersFileId`) will be null or not set.
        6.  Handle errors throughout the process (e.g., during question extraction, agent calls, file uploads) and update session status accordingly.
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
        - Log start of phase and update job/session status.
        - Iterate through sections needing revision (based on internal and/or customer reviews).
        - For each section:
            - Determine assigned `role` for revision.
            - Create `revisionPrompt` including original draft, review feedback.
            - Define `revisionContexts`.
            - Call `safeCreateResponse` for revision, chaining appropriately.
            - Store `revisedContent`.
            - Track token usage.
            - Upload revised section and get `revisedFileId`.
            - Store in `revisedSectionFileIds` map.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `sections`, `assignments`, `sectionFileIds`, `reviewFileIds`, `customerReviewAnswersFileId` (optional), `briefFileId`, `customerReviewResponseIdOrLastInternalReviewId`
    - **Outputs:** `{ revisedSectionFileIds, lastRevisionResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase3_revision.js`).
        - [ ] `runFullFlow` updated to call this function.

### Phase 4: Finalization & Assembly

1.  **Sub-Phase 4.1: Final Approval**
    - **Function:** `async function getFinalApproval(currentProposalId, sessionId, revisedSectionFileIdsOrSectionFileIds, briefFileId, lastRevisionResponseId)`
    - **Target File:** `agents/flowSteps/phase4_finalization.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Create `approvalPrompt` (e.g., for a "sp_Director" role).
        - Define `approvalContexts` (all final/revised section files).
        - Call `safeCreateResponse` for final approval, chaining.
        - Store `approvalDecision`.
        - Track token usage.
        - Upload approval decision and get `finalApprovalFileId`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `revisedSectionFileIds` (or `sectionFileIds` if no revision phase), `briefFileId`, `lastRevisionResponseId` (or last relevant ID)
    - **Outputs:** `{ finalApprovalFileId, finalApprovalResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase4_finalization.js`).
        - [ ] `runFullFlow` updated to call `getFinalApproval`

2.  **Sub-Phase 4.2: Proposal Assembly & Manifest**
    - **Function:** `async function assembleFinalProposal(currentProposalId, sessionId, revisedSectionFileIdsOrSectionFileIds, briefFileId, finalApprovalFileId)`
    - **Target File:** `agents/flowSteps/phase4_finalization.js`
    - **Responsibility:**
        - Log start of phase and update job/session status.
        - Create `assemblyPrompt` for the final proposal.
        - Define `assemblyContexts` (all final section files, brief, approval).
        - Call `safeCreateResponse` for proposal assembly, chaining from `finalApprovalFileId`.
        - Store `finalProposalContent`.
        - Track token usage.
        - Upload final proposal and get `finalProposalFileId`.
        - Handle errors and update session status.
    - **Inputs:** `currentProposalId`, `sessionId`, `revisedSectionFileIds` (or `sectionFileIds`), `briefFileId`, `finalApprovalFileId`
    - **Outputs:** `{ finalProposalFileId, finalProposalResponseId }`
    - **Status:**
        - [ ] Function defined (in its target file: `agents/flowSteps/phase4_finalization.js`).
        - [ ] `runFullFlow` updated to call `assembleFinalProposal`

---

## Consolidated Refactoring Task List

**I. Setup & Orchestrator Shell:**
- [ ] Create new directory: `agents/flowSteps/`
- [ ] Create `agents/flowAgentOrchestrator.js` (this will replace the old `flowAgent.js`)
- [ ] Create `agents/flowSteps/flowUtilities.js`

**II. Phase 0: Initialization & Setup**
- [ ] Define and implement `initializeFlow` in `agents/flowSteps/phase0_initializeFlow.js`
- [ ] Integrate `initializeFlow` call into `flowAgentOrchestrator.js`

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
