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

## Local Development

1. Clone the repo
2. Install dependencies: `npm install`
3. Start the server: `npm start` or `node index.js`

## Docker

```bash
docker-compose up --build  # build and run in Docker
```

## Testing

```bash
npm test  # runs Jest tests with coverage
```

## CI/CD

Add this badge to README to show CI status:

```markdown
[![CI status](https://github.com/<USER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<USER>/<REPO>/actions)
```
