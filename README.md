# Proposal Generator

A minimal MVP service to generate proposal drafts via HTTP requests.

## Overview

- **Tech stack**: Node.js, Express
- **Containerization**: Docker & Docker Compose
- **Testing**: Jest + Supertest
- **CI/CD**: GitHub Actions

## Environment Variables

- `PORT`: Server port (default: 3000)
- `TEMPLATE_DIR`: Directory for Handlebars templates (default: `templates`)
- `OPENAI_API_KEY`: API key for OpenAI calls (required for `/agents/proposals`)
- `OPENAI_TEMPERATURE`: Optional temperature setting for OpenAI LLM (default: 0.7)
- `OPENAI_TIMEOUT_MS`: Timeout in milliseconds for OpenAI API calls (default: 60000). Increase this value when using models like 'o1' that may require more processing time.

## Endpoints

- `GET /` → Returns `Hello, world!`
- `GET /health` → Returns `{ status: 'ok' }`
- `GET /proposals` → List all saved proposals
- `POST /proposals` → Create a proposal draft (Handlebars or default template)
- `GET /proposals/:id/html` → Render a saved proposal as HTML
- `GET /proposals/:id/pdf` → Render a saved proposal as PDF
- `POST /agents/proposals` → Generate a proposal via single-step LLM agent
- `POST /agents/collaborate` → Multi-agent collaboration flow (stubbed in test)
- `POST /agents/flow` → End-to-end QA, content development, review and final proposal (uses LangChain flows)
- `POST /api/flow/runFullFlow` → Modern endpoint for full proposal generation flow with additional options (see API Features below)

## API Features

### Parallel/Sequential Agent Question Generation

The `/api/flow/runFullFlow` endpoint supports both parallel and sequential specialist question generation:

- **Parameter**: `parallelAgentQuestionsMode` (boolean, default: `true`)
- **Behavior**:
  - When `true` (default): All specialist agents generate questions simultaneously for faster results
  - When `false`: Agents run sequentially, with each agent seeing previous agents' questions to reduce duplicates

Example request:
```json
{
  "brief": { 
    "projectTitle": "E-commerce Website Redesign",
    "projectDescription": "Client needs a modern redesign for their online store"
  },
  "parallelAgentQuestionsMode": false
}
```

## Local Development

1. Clone the repo
2. Install dependencies: `npm install`
3. Start the server: `npm start` or `node index.js`

## Docker

```bash
docker-compose up --build  # build and run in Docker
```

## Testing

To run the main test suite (excluding legacy/archived tests):

```bash
./scripts/test-no-archive.sh
```

This script ensures that tests in `tests/archive/` (which may reference obsolete endpoints or legacy file-based DB logic) are not run. Do **not** use `npm test` or `npx jest` directly, as these may run archived tests and recreate legacy files like `data/db.json`.

## CI/CD

Add this badge to README to show CI status:

```markdown
[![CI status](https://github.com/<USER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<USER>/<REPO>/actions)
```
