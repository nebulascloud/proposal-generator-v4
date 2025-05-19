# Enhanced Review Process Implementation Plan

## Overview
This document outlines the plan for enhancing the proposal review process in the proposal generator. The current implementation has the orchestrator reviewing each section individually, but we're implementing a more collaborative and thorough approach involving all assistants in the review process, followed by customer feedback and section refinement.

## Current Review Process
Currently in `flowAgent.js`, the review process works as follows:
1. The orchestrator reviews each section individually
2. There's no feedback loop for addressing comments
3. There's no opportunity for customer input based on review comments
4. There's no mechanism for the original section author to update based on reviews

## Enhanced Review Process
We'll implement a more robust multi-stage review process:

### 1. Multi-Assistant Sequential Reviews
- Each section will be reviewed by all assistants (not just the orchestrator)
- Reviews will happen sequentially, with each assistant building on previous feedback
- Assistants will avoid repeating feedback that's already been given

### 2. Structured Review Format
Each review will include:
- General feedback on the section
- Suggested revisions to improve the section
- Questions for the drafting agent
- Questions for the customer

### 3. Customer Feedback Loop
- Questions for the customer will be collected from all reviews
- Customer will be given an opportunity to answer these questions

### 4. Author Revision Process
- The original section author will:
  - Review all feedback from other assistants
  - Review customer answers to questions
  - Address questions from other agents
  - Update their draft accordingly

### 5. Final Review Cycle
- All assistants will review the updated draft
- They'll confirm whether their feedback has been addressed
- Limited to 2 review cycles to prevent endless loops

## Implementation Strategy

### 1. Modify flowAgent.js
- Replace the current review step with the enhanced multi-stage process
- Add the customer feedback loop
- Add the author revision step
- Add the final review cycle with loop prevention

### 2. Develop New Prompts
- Create a new review prompt template
- Create a prompt for consolidating questions for the customer
- Create a prompt for the author to address feedback and update the draft
- Create a prompt for the final review cycle

### 3. Add Loop Prevention
- Implement a mechanism to track review cycles and limit to 2 rounds
- Use a conditional approach to differentiate between initial drafts and revisions

### 4. Test Implementation
- Update tests to reflect the new review workflow
- Test the complete flow to ensure proper handling of feedback and revisions

## Code Structure Changes

### New Variables and States
- `reviewRound`: Track which review round we're in (1 or 2)
- `feedbackCollections`: Store feedback from all assistants
- `customerQuestions`: Aggregate questions for the customer
- `customerReviewAnswers`: Store customer answers to review questions

### New Functions/Methods
- `collectAssistantReviews()`: Gather reviews from all assistants for a section
- `extractCustomerQuestions()`: Extract questions for the customer from reviews
- `processAuthorRevision()`: Handle author's revision of the section
- `conductFinalReview()`: Complete the final review cycle

### Modified Functions/Methods
- `runFullFlow()`: Update to include the enhanced review process

## Testing Strategy
- Update existing tests to account for the new multi-stage review process
- Add new tests specifically for the feedback loop functionality
- Test edge cases where feedback might be minimal or extensive

## Progress Tracking

### Current Status
- Created feature branch: `feature/enhanced-review-process`
- Created implementation plan

### Next Steps
1. Implement the enhanced review process in flowAgent.js
2. Update any dependent tests
3. Test the functionality end-to-end
4. Document the changes in code comments and update relevant documentation
