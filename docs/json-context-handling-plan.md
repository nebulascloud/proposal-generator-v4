# JSON Context Handling Plan

## Problem Statement
The OpenAI Responses API doesn't accept JSON files as attachments, but our application relies heavily on JSON data for context.

## Current Status
- We have implemented a database-backed message monitoring system
- JSON data is stored in the database as metadata
- We're still attempting to upload JSON files to OpenAI in some cases

## Solution: JSON Context Handler

We will create a dedicated module to handle JSON context extraction and inclusion in prompts.

### Implementation Steps

1. **Create JSON Context Handler Module**
   - [ ] Implement a module that extracts relevant parts of JSON data
   - [ ] Add functions to format JSON data for inclusion in prompts
   - [ ] Add utility for referencing context by ID

2. **Update Responses Agent**
   - [ ] Modify `createAndUploadFile` to handle JSON data differently
   - [ ] Add check for JSON files before attempting upload
   - [ ] Integrate with JSON Context Handler for JSON files

3. **Implement Context Storage**
   - [ ] Create a new table or use existing message metadata for JSON context
   - [ ] Add functions to store and retrieve JSON context by ID
   - [ ] Add versioning for context to track changes

4. **Update Prompt Templates**
   - [ ] Modify prompt templates to work with inline JSON context
   - [ ] Create formatting helpers for different types of JSON data
   - [ ] Implement a strategy for large JSON data (pagination, summarization)

## Implementation Details

### JSON Context Handler Interface
```javascript
// Extract relevant context from a JSON object based on a query
extractContext(jsonData, query, options);

// Format JSON data for inclusion in a prompt
formatForPrompt(jsonData, format = 'markdown');

// Store a JSON object and get a reference ID
storeContext(jsonData, metadata);

// Retrieve a JSON object by its reference ID
getContext(contextId);
```

### Usage Example
Instead of:
```javascript
const fileId = await responsesAgent.createAndUploadFile(customerBrief, `proposal-${proposalId}_brief.json`);
const response = await responsesAgent.createInitialResponse("Analyze this brief", [fileId], "sp_Brief_Analyzer");
```

We would use:
```javascript
const contextId = await jsonContext.storeContext(customerBrief, { type: 'brief', proposalId });
const briefSummary = await jsonContext.extractContext(customerBrief, 'summary');
const prompt = `Analyze this brief:\n\n${jsonContext.formatForPrompt(briefSummary)}`;
const response = await responsesAgent.createInitialResponse(prompt, [], "sp_Brief_Analyzer");
```

## Testing Strategy
- Unit tests for context extraction and formatting
- Integration tests with the Responses API
- Performance testing for large JSON objects

## Timeline
- Implementation: 2-3 days
- Testing: 1-2 days
- Integration: 1-2 days

Total: 4-7 days
