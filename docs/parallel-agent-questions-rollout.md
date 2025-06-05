# Parallel/Sequential Agent Question Generation Mode Rollout

**Date:** 2025-06-05

## Feature Overview

The proposal generator now supports both parallel and sequential modes for specialist agent question generation. This feature allows for faster processing (parallel mode) or more contextually aware questions with fewer duplicates (sequential mode).

## API Changes

The `/api/flow/runFullFlow` endpoint now accepts a new parameter:

- **Parameter**: `parallelAgentQuestionsMode` (boolean)
- **Default**: `true` (parallel mode)
- **Values**:
  - `true`: All specialist agents generate questions simultaneously, optimizing for speed
  - `false`: Agents run one after another, with each agent seeing questions from previous agents to reduce duplicates

## Examples

### Parallel Mode (Default)

```json
POST /api/flow/runFullFlow
{
  "brief": {
    "projectTitle": "Website Redesign",
    "projectDescription": "Modern update to our company website"
  }
}
```

### Sequential Mode

```json
POST /api/flow/runFullFlow
{
  "brief": {
    "projectTitle": "Website Redesign",
    "projectDescription": "Modern update to our company website"
  },
  "parallelAgentQuestionsMode": false
}
```

## Migration Notes

- Existing clients do not need to make any changes - the default behavior (parallel mode) is unchanged
- For cases where question quality and reduced duplication is more important than speed, clients can opt into sequential mode

## Implementation Details

- Sequential mode passes a formatted summary of previous agents' questions to each subsequent agent
- A specialized prompt instructs agents to avoid duplicating questions already asked
- Error handling collects results from successful agents even if some fail
- Warning messages identify any agents that failed to generate questions

## Performance Considerations

- Parallel mode is faster but may result in some duplicate questions across specialists
- Sequential mode takes longer to complete but typically results in more diverse questions
- Token usage is higher in sequential mode due to the context of previous questions

## Monitoring & Debugging

Flow logs now indicate which mode is being used:
- `Using PARALLEL mode for agent question generation`
- `Using SEQUENTIAL mode for agent question generation`

Each specialist agent question generation session also logs its mode:
- `Running specialist question generation in PARALLEL mode`
- `Running specialist question generation in SEQUENTIAL mode`

## Future Improvements

- Consider adding a hybrid mode that groups specialists by domain and runs groups in parallel 
- Add metrics to compare question quality between modes
- Optimize sequential mode prompt to reduce token usage
