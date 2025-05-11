# Proposal Generator

A minimal MVP service to generate proposal drafts via HTTP requests.

## Overview

- **Tech stack**: Node.js, Express
- **Containerization**: Docker & Docker Compose
- **Testing**: Jest + Supertest
- **CI/CD**: GitHub Actions

## Endpoints

- `GET /` &rarr; Returns `Hello, world!`
- `GET /health` &rarr; Returns `{ status: 'ok' }`

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
