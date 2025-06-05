# Plan: Parallel and Sequential Agent Question Generation Modes

**Date:** 2025-06-04

## Overview

This plan details the implementation of a switchable parallel/sequential agent question generation mode in the proposal generation flow, controlled by the `parallelAgentQuestionsMode` parameter in the `/api/flow/runFullFlow` API. The default will be parallel mode for speed, with sequential mode providing additional context to reduce duplicate questions.

---

## Goals
- Allow agent question generation to run in parallel (default) or sequentially (with context chaining).
- Return partial results: successful agent questions and warnings for any failed agents.
- Enable switching modes via the `parallelAgentQuestionsMode` API parameter.
- In sequential mode, chain agent messages and add a prompt to reduce duplicate questions.

---

## API Layer
- **Endpoint:** `/api/flow/runFullFlow`
- **Parameter:** `parallelAgentQuestionsMode` (boolean, default: `true`)
- **Behavior:**
  - If `true`: Run all agent question generations in parallel.
  - If `false`: Run sequentially, passing previous agent questions as context to the next agent and modifying the prompt to encourage unique questions.
- **Response:**
  - Always return all successful agent results.
  - If any agent fails, include a warning with agent names and error messages.

---

## Technical Tasks & Phases

### Phase 1: Planning & Design
- [x] Document requirements and desired behaviors (this document)
- [x] Review current flow and identify all affected code paths
    - `/api/flow/runFullFlow` endpoint (API layer)
    - `flowAgentOrchestrator.js` (orchestrator logic)
    - `agents/flowSteps/phase1_questionGeneration.js` (specialist question generation step)
    - Any utility or helper functions for prompt/context construction
    - Unit/integration tests for the above
- [x] Design error/warning structure for partial results
    - **Example structure:**
      ```json
      {
        "agentResults": {
          "sp_Account_Manager": { "questions": [...] },
          "sp_Project_Manager": { "questions": [...] }
        },
        "warnings": [
          { "agent": "sp_Lead_Engineer", "error": "OpenAI API timeout" },
          { "agent": "sp_Data_Architect", "error": "Rate limit exceeded" }
        ]
      }
      ```

### Phase 2: API & Parameter Propagation
- [x] Update API docs and OpenAPI spec for new parameter
- [x] Ensure `/api/flow/runFullFlow` accepts and propagates `parallelAgentQuestionsMode`
- [x] Add logging for mode selection in orchestrator and flow logic (ensure logs clearly indicate which mode is active for each run)
- [x] Review `index.js` and remove or mark as deprecated any Swagger docs for endpoints that are no longer in use
    - `/agents/flow` endpoint marked as `deprecated: true` in Swagger docs, with a note to use `/api/flow/runFullFlow` instead. No other deprecated endpoints found at this time.

### Phase 3: Flow Step Refactor
- [x] Refactor question generation step to support both modes
  - [x] Parallel: Use `Promise.all` for agent question calls
  - [x] Sequential: Chain calls, pass previous results as context, and modify prompt
- [x] Implement error collection and partial result reporting
- [x] Add prompt modification for sequential mode to reduce duplicates

### Phase 4: Testing & Validation
- [x] Unit tests for both modes (parallel/sequential)
- [x] Integration tests for partial results and error handling
- [ ] Performance comparison (optional)

### Phase 5: Documentation & Rollout
- [x] Update user/developer documentation
- [x] Add migration/rollout notes
- [x] Mark plan as complete

### Phase 6: Legacy Endpoint Refactor & Cleanup
- [x] Move all legacy/deprecated endpoints from `index.js` to dedicated route modules in `routes/`
    - `/agents/proposals` → `routes/agentsProposals.js`
    - `/agents/orchestrate` and related GETs → `routes/agentsOrchestrate.js`
    - `/agents/assistants` and `/agents/assistants/{assistantId}/messages` → `routes/agentsAssistants.js`
    - `/agents/flow` and related status/result GETs → `routes/agentsFlow.js`
- [x] In `index.js`, remove all legacy endpoint handler code and replace with `app.use()` for new routers (index.js is now focused on app setup, middleware, monitor, and new flow registration only)
- [x] Ensure all Swagger/OpenAPI docs for these endpoints are moved to the new route files
- [x] Confirm all tests and documentation reference the new route files
- [x] Mark this phase complete when `index.js` is focused on app setup, middleware, and new flow registration only

---

## Design Notes
- **Default Mode:** `parallelAgentQuestionsMode=true` (parallel)
- **Sequential Mode:** Each agent receives a summary of all previous agents' questions in their prompt, not the full message chain, to optimize for token usage.
    - After each agent's question generation, generate a concise summary (using either a deterministic function or an LLM call) of all questions so far.
    - Pass this summary as context to the next agent, along with an explicit instruction to avoid duplicates and trivial questions.
    - If the last agent feels all questions have been covered, they should respond with no questions.
    - If the summary becomes too long, further summarize or truncate to stay within token limits.
    - Log context length and token usage for monitoring.
    - If an agent fails, continue with the next agent and include a warning in the final result.
- **Partial Results:** If any agent fails, return all successful results and a warning array with agent names and error messages.
- **Backwards Compatibility:** Existing clients will default to parallel mode.

---

## Risks & Considerations
- **API Rate Limits:** Parallel mode may increase risk of hitting rate limits.
- **Prompt Length:** Sequential mode may result in longer prompts; monitor for token limits.
- **Error Handling:** Ensure robust handling so one agent's failure does not block others.

---

## Progress Tracking
- [x] Phase 1: Planning & Design
- [x] Phase 2: API & Parameter Propagation
- [x] Phase 3: Flow Step Refactor
- [x] Phase 4: Testing & Validation
- [x] Phase 5: Documentation & Rollout
- [x] Phase 6: Legacy Endpoint Refactor & Cleanup

---

**Status:**
- API parameter properly propagated and OpenAPI documentation updated.
- Tests passing with the new parameter.
- Legacy endpoint refactoring complete.
- Parallel and sequential modes implemented in flowAgentOrchestrator.js.
- Question formatting functionality improved for better sequential context.
- Fixed bug in sequential mode to correctly handle context retrieval with contextModel.
- Docker container built and tested with the new parameter.
- Documentation and rollout complete.
- FEATURE COMPLETE: 2025-06-05
