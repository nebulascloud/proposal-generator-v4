# Message Monitoring System Implementation Plan

## Overview
This document outlines the plan to implement a database-backed message monitoring system to replace the thread-based monitoring lost during migration from OpenAI's Assistants API to the Responses API.

## Goals
- Create a persistent storage solution for all API interactions
- Implement a simple web UI for monitoring message flows
- Enable better debugging and troubleshooting
- Provide insights into the proposal generation process

## Database Schema

### Messages Table
```
messages
├── id (primary key, UUID)
├── response_id (string, from OpenAI)
├── phase (string: 'clarification', 'draft', 'review', etc.)
├── agent_name (string)
├── role (string: 'user', 'assistant')
├── content (text)
├── parent_message_id (foreign key, nullable)
├── metadata (JSON)
├── created_at (timestamp)
├── updated_at (timestamp)
```

### Agents Table
```
agents
├── id (primary key)
├── name (string)
├── instructions (text)
├── created_at (timestamp)
├── updated_at (timestamp)
```

### Sessions Table (for grouping messages by proposal)
```
sessions
├── id (primary key, UUID)
├── proposal_id (string)
├── customer_brief_id (string)
├── status (string: 'active', 'completed')
├── metadata (JSON)
├── created_at (timestamp)
├── updated_at (timestamp)
```

### Contexts Table (for storing JSON data)
```
contexts
├── id (primary key, UUID)
├── data (text, JSON data)
├── metadata (JSON)
├── created_at (timestamp)
├── updated_at (timestamp)
```

## Implementation Steps

### Phase 1: Database Setup

1. **Set up database connection**
   - [x] Choose database (SQLite for development, PostgreSQL for production)
   - [x] Set up connection in the application
   - [x] Create migration scripts for schema

2. **Create models and repositories**
   - [x] Implement models for Messages, Agents, and Sessions
   - [x] Create repository pattern for database operations
   - [x] Add utility functions for common queries

### Phase 2: API Integration

3. **Update Responses API integration**
   - [x] Modify `responsesAgent.js` to log all interactions
   - [x] Store agent instructions when creating agents
   - [x] Track message relationships (parent/child)

4. **Update file handling approach**
   - [x] Store JSON data directly in database instead of uploading files
   - [x] Reference data by ID in prompts
   - [x] Include relevant data snippets directly in messages
   - [x] Implement JSON context handler for extracting and formatting JSON data
   - [x] Create utility for building context from stored messages

### Phase 3: Monitoring UI

5. **Create basic web interface**
   - [x] Set up Express routes for the monitoring UI
   - [x] Implement message listing with filtering options
   - [x] Add message detail view with formatting

6. **Implement real-time updates**
   - [ ] Add WebSocket support for live updates
   - [ ] Create notification system for new messages

### Phase 4: Enhanced Features

7. **Add advanced visualization**
   - [ ] Create conversation flow diagram
   - [ ] Implement timeline visualization
   - [ ] Add performance metrics

8. **Improve search and filtering**
   - [x] Full-text search for message content
   - [x] Advanced filtering by metadata
   - [ ] Export functionality

### Phase 5: Containerization (Added)

9. **Set up Docker environment**
   - [x] Create separate Docker container for database
   - [x] Update Docker Compose configuration
   - [x] Configure environment variables for database connection
   - [x] Update application to use PostgreSQL in production
   - [x] Add unit tests for Docker & PostgreSQL integration

## Technical Details

### Database Connection
We'll use Knex.js as the query builder with database-specific adapters:
- Development: SQLite (simple setup, minimal dependencies)
- Production: PostgreSQL (scalable, robust)

### Docker Configuration
- Main app container: Node.js application
- Database container: PostgreSQL
- Persistent volume for database data
- Environment variables for configuration

### JSON Data Handling
Instead of uploading JSON files to OpenAI (which has format limitations):
- Store JSON data in a dedicated "contexts" table
- Extract relevant portions based on the current needs
- Format JSON data for inclusion directly in prompts
- Build message context from database instead of files

### API Integration
The `responsesAgent.js` file will be enhanced to:
1. Log each message before sending to OpenAI
2. Store response data after receiving from OpenAI
3. Track message relationships to reconstruct conversations

### UI Technology Stack
- Backend: Express.js (already in use)
- Frontend: Simple HTML/CSS/JS with optional framework (Vue.js)
- Data visualization: D3.js for flow diagrams

## Timeline

- **Phase 1**: 2-3 days ✓ Completed
- **Phase 2**: 2-3 days ✓ Completed
- **Phase 3**: 3-4 days ✓ Completed
- **Phase 4**: 3-5 days (partial completion)
- **Phase 5**: 1-2 days ✓ Completed

Total estimated time: 10-15 days depending on complexity and optional features

## Milestones

1. ✓ Database schema implemented and migrations working
2. ✓ API interactions properly logged to database
3. ✓ Basic UI showing message history
4. ⚠️ Complete monitoring system with visualization (partial)
5. ✓ Docker configuration for separate database container

## Testing Strategy

- [x] Unit tests for database models and repositories
- [x] Integration tests for API logging functionality
- [x] End-to-end tests for the monitoring UI
- [x] Unit tests for Docker and PostgreSQL configuration
- ⚠️ Performance testing for database queries (pending)
