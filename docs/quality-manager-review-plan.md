# Quality Manager Review Process Implementation Plan

## Overview
This document outlines the plan for revising our review process to use a dedicated Quality Manager assistant instead of having every assistant review each section. The current implementation resulted in excessive token usage (~3.5 million tokens) and failures. We'll create a new `sp_Quality_Manager` role specifically designed for comprehensive reviews.

## Current Issues
1. Token usage is excessive with the multi-assistant review approach
2. Runs are failing due to the high API usage
3. Review process is inefficient with too many reviewers involved

## Implementation Strategy

### 1. Create Quality Manager Role
- [ ] Define a new `sp_Quality_Manager` role in assistantDefinitions.js
- [ ] Create a comprehensive prompt that covers strategy, sales, technology, delivery, and commercial aspects
- [ ] Ensure the Quality Manager has instructions to provide structured feedback

### 2. Update Review Process in flowAgent.js
- [ ] Remove the multi-assistant review process
- [ ] Replace with a streamlined Quality Manager review process
- [ ] Reuse the successful review prompt structure:
  ```
  Review the following section and provide feedback, suggested revisions, questions for the drafting agent, and questions for the customer. Pay attention to...

  Title: {title}
  Content: {content}

  Your feedback should include:
  1. General feedback on the section.
  2. Suggested revisions to improve the section.
  3. Questions for the drafting agent.
  4. Questions for the customer (only if high-value).
  ```

### 3. Maintain Customer Feedback Loop
- [ ] Extract high-value questions for the customer from the Quality Manager's reviews
- [ ] Send questions to the customer
- [ ] Integrate customer answers into the revision process

### 4. Revise Section Update Process
- [ ] Have original authors revise their sections based on Quality Manager feedback
- [ ] Include customer answers in the revision context
- [ ] Limit to one review/revision cycle to conserve tokens

### 5. Update Tests
- [ ] Update flow.test.js to reflect the new Quality Manager review process
- [ ] Update mock data structure for testing

## Code Structure Changes

### New Components
1. New `sp_Quality_Manager` role in assistantDefinitions.js
2. Simplified review process in flowAgent.js

### Data Structure Updates
- Reviews object will track Quality Manager reviews and customer answers
- Simpler structure without multiple reviewer roles

## Implementation Progress Tracking
- [X] Create feature branch
- [X] Define Quality Manager role
- [ ] Update flowAgent.js review process
- [ ] Update tests
- [ ] Run tests and verify functionality
- [ ] Update documentation
- [ ] Commit changes
- [ ] Push feature branch
