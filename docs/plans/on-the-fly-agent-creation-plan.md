# Plan: On-the-Fly Agent Creation and `agents` Table Revitalization

**Date:** 2025-06-02

**Overall Goal:** To transition the `agents` database table from a potentially cluttered state to a clean, dynamically managed repository of agent records. Agents will be created or updated on-the-fly based on definitions in `assistantDefinitions.js` when first encountered by the proposal generation flow, ensuring data integrity and simplifying agent management.

**Current State/Problem:**
*   The `agents` database table may contain outdated, incorrect, or non-agent entries due to previous parsing issues or manual entries.
*   There isn't a strict, automated link ensuring that every agent used in the flow (especially those defined in `assistantDefinitions.js`) has an accurate and up-to-date record in the `agents` table.
*   The `Agent.getOrCreate()` function exists but is not consistently used throughout the new refactored flow logic (`flowAgentOrchestrator.js` and `flowSteps/` files) to ensure agents are in the database.

**Proposed Solution:**
1.  Establish `assistantDefinitions.js` as the definitive source of truth for all agent names, instructions, and configurations.
2.  Purge the existing `agents` table to remove all current entries (after a backup).
3.  Implement a two-fold strategy for integrating `Agent.getOrCreate(name, instructions)`:
    *   An initial "warm-up" step at the beginning of each flow execution to synchronize all defined agents with the database.
    *   Per-interaction calls within flow steps to ensure the specific agent being used has its latest instructions recorded in the database.

## Detailed Phases and Steps

### Phase 1: Preparation & Cleanup

*   [ ] **Backup `agents` Table:**
    *   **Task:** Create a complete backup of the current `agents` table.
    *   **Details:** Use database-specific dump/backup commands (e.g., `pg_dump` for PostgreSQL, `sqlite3 .dump data/messages.sqlite .dump agents > agents_backup.sql` for SQLite).
    *   **Responsibility:** Developer
    *   **Notes:** Crucial for safeguarding against accidental data loss.
*   [ ] **Purge `agents` Table (To be done *after* code changes are tested and *before* final deployment):**
    *   **Task:** Execute a command to delete all records from the `agents` table and reset its auto-increment sequence.
    *   **Details (SQLite Example):**
        ```sql
        DELETE FROM agents;
        DELETE FROM sqlite_sequence WHERE name='agents'; 
        ```
    *   **Details (PostgreSQL Example):**
        ```sql
        TRUNCATE TABLE agents RESTART IDENTITY CASCADE;
        ```
    *   **Responsibility:** Developer (during deployment/migration)
    *   **Notes:** Provides a clean slate for the new on-the-fly creation mechanism.

### Phase 2: Code Implementation & Integration

*   [ ] **Verify `assistantDefinitions.js` is Comprehensive and Accessible:**
    *   **Task:** Review and ensure `assistantDefinitions.js` exports a clear, accessible structure (e.g., the existing `assistantDefinitions` object) and that it contains definitions for all agents intended for use in the flow.
    *   **Details:** Each definition must include at least `name` (as the key) and `instructions`. Verify all required agents are present.
    *   **Key Files:** `agents/assistantDefinitions.js`
    *   **Responsibility:** Developer
*   [ ] **Agent Definition Retrieval from `assistantDefinitions.js`:**
    *   **Task:** Ensure flow steps directly access the imported `assistantDefinitions` object to retrieve an agent's instructions by its name.
    *   **Details:**
        *   Logic: `const instructions = assistantDefinitions[agentName];` (after importing `assistantDefinitions` from `../assistantDefinitions.js`).
        *   Error Handling: Implement robust error handling in flow steps for cases where an `agentName` might not be found as a key in the `assistantDefinitions` object (e.g., log a critical warning, throw an error to halt the flow, or handle gracefully if a default/fallback is appropriate).
    *   **Responsibility:** Developer
*   [ ] **Integrate `Agent.getOrCreate()` into Flow Logic (Two-Fold Strategy):**
    *   **Task 1: Initial Agent Sync (Warm-up) in Orchestrator:**
        *   **Location:** `agents/flowAgentOrchestrator.js` (likely at the beginning of `runFullFlow` or a dedicated initialization step).
        *   **Logic:**
            1.  Import `Agent` from `../db/models/agent.js` and `assistantDefinitions` from `../assistantDefinitions.js`.
            2.  Iterate through all agent names (keys) in the `assistantDefinitions` object.
            3.  For each agent: `await Agent.getOrCreate(agentName, assistantDefinitions[agentName]);`.
        *   **Purpose:** Ensures all agents defined in `assistantDefinitions.js` are present in the database and their instructions are up-to-date at the start of every flow execution.
        *   **Responsibility:** Developer
    *   **Task 2: Per-Interaction `Agent.getOrCreate()` Call in Flow Steps:**
        *   **Location:** Within individual flow step files in `agents/flowSteps/` right before an agent is invoked or its DB record is needed.
        *   **Logic:**
            1.  Obtain the specific `agentName` to be used.
            2.  Retrieve its `instructions` directly from the imported `assistantDefinitions` object: `const instructions = assistantDefinitions[agentName];` (include error handling for missing definitions as per the previous task).
            3.  Call `const agentRecord = await Agent.getOrCreate(agentName, instructions);` (import `Agent` from `../../db/models/agent.js`).
            4.  Use `agentRecord.id` or `agentRecord.name` for subsequent operations.
        *   **Purpose:** Guarantees that the specific agent being used has its *absolute latest* instructions (from the in-memory `assistantDefinitions.js`) recorded in the database. This handles cases where `assistantDefinitions.js` might have been updated between the initial warm-up and the agent's use, or between different flow runs. It also ensures data integrity at the precise moment of use.
    *   **Key Files for Per-Interaction Integration (Initial List - requires thorough audit):**
        *   [ ] `agents/flowSteps/phase1_briefProcessing.js` (for "SectionAssignments" agent and derived specialist roles)
        *   [ ] `agents/flowSteps/phase1_questionGeneration.js` (for specialist roles)
        *   [ ] `agents/flowSteps/phase2_customerInteraction.js` (if any specific agents like "CustomerInteractionAgent" are used)
        *   [ ] `agents/flowSteps/phase2_drafting.js` (for specialist roles drafting sections)
        *   [ ] `agents/flowSteps/phase3_review.js` (for "QualityManager" or other review agents)
        *   [ ] `agents/flowSteps/phase3_revision.js` (if specific revision agents are used)
        *   [ ] `agents/flowSteps/phase4_finalization.js` (if specific finalization agents are used)
        *   [ ] `agents/responsesAgent.js` (Calls to `Agent.getOrCreate` should occur *before* invoking `responsesAgent.createResponse` or similar methods if a DB `agent_id` is required by `responsesAgent` for logging/tracking. The calling flow step will be responsible for this.)
    *   **Responsibility:** Developer

### Phase 3: Testing & Validation

*   [ ] **Unit Tests:**
    *   **Task:** Write/verify unit tests for error handling when retrieving definitions from `assistantDefinitions`.
    *   **Details:** Ensure graceful failure or clear errors if an agent name is not found.
    *   **Task:** Ensure existing unit tests for `Agent.getOrCreate` cover creation and instruction update scenarios thoroughly.
    *   **Responsibility:** Developer
*   [ ] **Integration Tests:**
    *   **Task:** Conduct thorough integration testing in a development/staging environment with a purged `agents` table.
    *   **Details:**
        *   Run the full proposal generation flow across various scenarios.
        *   Verify the initial warm-up correctly populates/updates all agents in the DB.
        *   Verify that agents are created/updated correctly by per-interaction calls.
        *   Test the instruction update mechanism: change an instruction in `assistantDefinitions.js`, rerun the flow, and verify the `agents` table reflects the update both after warm-up and after specific agent interaction.
    *   **Responsibility:** Developer/QA
*   [ ] **Data Integrity Check:**
    *   **Task:** Manually inspect the `agents` table after test runs.
    *   **Details:** Confirm data consistency, absence of duplicates, and correctness of instructions.
    *   **Responsibility:** Developer/QA

## Key Files Involved:

*   `agents/assistantDefinitions.js` (Source of truth for agent definitions)
*   `db/models/agent.js` (Contains `getOrCreate` and other agent DB interactions)
*   All files within `agents/flowSteps/` that utilize agents.
*   `agents/flowAgentOrchestrator.js` (Will implement the initial agent sync/warm-up)
*   `agents/responsesAgent.js` (Interaction point for AI calls; `Agent.getOrCreate` will be called by its invoking flow step)

## Alignment with Refactoring Goals:

*   **Single Responsibility:** `Agent.getOrCreate` handles DB persistence. `assistantDefinitions.js` is the single source for definitions. Flow steps orchestrate. This aligns well.
*   **Clear Inputs/Outputs:** Interactions will be based on agent names and instructions.
*   **Improved Error Handling:** Direct access to `assistantDefinitions` requires careful error handling for missing keys. `Agent.getOrCreate` manages DB errors.
*   **Maintainability:** Centralizing definitions and using a consistent creation pattern simplifies agent management and ensures DB accuracy.
*   **Reduced Clutter:** Purging the table removes legacy issues.

## Risks & Considerations:

*   **Initial Purge:** The database purge is a destructive operation. Backups are critical. This step must be carefully timed during deployment.
*   **Completeness of `assistantDefinitions.js`:** All agents intended for use *must* be defined here. Robust error handling for missing definitions is key.
*   **Performance:** The "Initial Agent Sync (Warm-up)" will involve multiple DB calls at the start of each flow. Subsequent per-interaction calls to `getOrCreate` are lightweight (typically one SELECT, potentially one UPDATE if instructions changed). Given the significant AI processing time in the flow, this overhead is acceptable for the gained data integrity and up-to-dateness.
*   **Circular Dependencies:** Standard vigilance required when importing modules (e.g., `assistantDefinitions.js`, `Agent` model) across different files.
*   **Transaction Management (Optional):** For extreme robustness, one might consider if agent creation should be part of a larger transaction, but this adds complexity and is likely overkill for this specific task.

This plan provides a comprehensive roadmap. We can refine it further based on your feedback.
