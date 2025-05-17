# Clarifying Questions Improvement Plan

## Overview
This document outlines the plan for improving how clarifying questions are handled in the proposal generator. The current implementation has several issues that need to be addressed:

1. Role confusion: The application doesn't clearly distinguish between service provider roles and customer roles
2. Section-focused questions: Questions are currently tied to specific sections, leading to redundant or inappropriate questions
3. Poor quality questions: Some questions are asking the customer how to write the proposal rather than gathering useful information
4. Inefficient token usage: Current approach results in unnecessary token consumption

## Current Implementation
After reviewing the code, we found:

1. The assistantDefinitions.js already has the updated role naming (sp_* and cst_*), but these aren't reflected in the rest of the codebase.
2. flowAgent.js generates questions per section: 
   - The orchestrator generates questions for each section
   - Each question is sent individually to the customer for an answer
   - Section answers are directly passed to section drafting
3. The mapRoleToAssistant function in assistantAgent.js uses the old "RPE" prefixed roles

## Implementation Plan

### 1. Role Clarification
- [x] Update mapRoleToAssistant function in assistantAgent.js to map to the new sp_* and cst_* roles
- [x] Update references to roles in orchestratorAgent.js
- [x] Update references to roles in flowAgent.js
- [x] Update references to roles in tests
- [x] Remove or update any RPE prefixes in the function mappings

### 2. Question Generation Process
- [x] Rewrite the question generation process in flowAgent.js:
  - [x] Replace steps 3 & 4 with the new workflow
  - [x] Create a new step to have each specialist generate questions about the entire brief
  - [x] Add a step for the orchestrator to collate and deduplicate questions
  - [x] Implement a consolidated prompt to send all questions to the customer at once
  - [x] Store the customer's single comprehensive response in the thread context
- [x] Update the section development process to use thread context instead of section-specific answers

### 3. Assistant Instructions & Prompt Refinement
- [x] Update prompts in flowAgent.js to ensure high-quality questions
- [x] Add prompts for specialists to generate relevant expert questions
- [x] Create a prompt for the orchestrator to collate questions effectively
- [x] Develop a comprehensive prompt for the customer to answer all questions at once

### 4. Testing
- [x] Update unit tests to work with the new role names
- [ ] Test the entire flow to ensure proper question generation and handling

## Progress Tracking

### Current Status
- Created feature branch: `feature/clarifying-questions-improvement`
- Created implementation plan
- Reviewed existing code to understand current implementation
- Completed role clarification updates (step 1)
- Completed question generation process improvements (step 2)
- Completed prompt refinement (step 3)
- Updated unit tests for role name changes (partial step 4)

### Completed Items
- Created feature branch
- Analyzed current implementation
- Updated implementation plan with detailed changes
- Updated mapRoleToAssistant function in assistantAgent.js
- Updated role references in flowAgent.js and orchestratorAgent.js
- Updated role references in tests
- Implemented new specialist question generation workflow
- Added question deduplication and organization by orchestrator
- Created consolidated customer prompting approach
- Modified section drafting to use thread context
- Updated mock implementation for testing

### Completed Tasks
- Fixed failing tests in orchestratorAgent.test.js by updating role expectations to 'sp_Account_Manager'
- Fixed failing tests in flow.test.js by updating to work with new questionsAndAnswers format
- Fixed inconsistent role naming in orchestratorAgent.js (using 'sp_Collaboration_Orchestrator')
- Run full test suite with all tests passing

### Next Steps
- Commit and push changes to repository
- Consider creating release notes or updating documentation
