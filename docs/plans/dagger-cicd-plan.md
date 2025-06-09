# Dagger-First CI/CD Upgrade — PRD & Execution Plan

---

## 1. Project Requirements Document (PRD)

**Project**: Dagger-First Pipeline Upgrade  
**Owner**: Robert Harkin

### Problem
Current development workflow is manual and slow, with inconsistent environments and limited automation. GitHub Copilot lacks access to domain-specific developer documentation (like Dagger.io), and workflows require repetitive terminal tasks and YAML-based CI pipelines.

### Goals
- G1: Use one Docker build across dev, test, and prod
- G2: Write pipelines in Dagger SDK (not YAML)
- G3: Implement caching, secret injection, and modular functions per `dagger/container-use`
- G4: Improve Copilot’s context via DevDocs MCP
- G5: Modularise AI agents for concurrent development (stretch goal)

### Success Metrics
- CI hot build time < 60 seconds
- Dagger pipelines run identically in local dev and CI
- Minimal to no new YAML introduced
- Copilot can answer Dagger usage questions offline via MCP
- Agents can be built and tested independently

---

## 2. Architecture Summary

```text
Local VS Code Dev Container
└─> Dagger pipeline (ci.dagger.ts)
    └─> GHCR build/push
    └─> Integration/Unit/E2E tests
    └─> Optional preview deploy
    └─> GitHub Actions wrapper
    └─> DevDocs MCP for agent context
3. Responsibilities Key
Human: Must be performed manually in terminal, UI or browser

Agent: Can be performed by GitHub Copilot Chat inside VS Code

4. Task Breakdown
4.0 Environment Setup
Human: Install VS Code ≥1.90, Copilot Chat extension ≥v0.18

Human: Enable BuildKit in Docker Desktop

Human: Install pnpm@9+ (npm i -g pnpm)

Human: Create GitHub secrets: GHCR_TOKEN, optionally FLY_API_TOKEN

Human: Save this file as TASKS.md in project root

4.1 Project Bootstrap
Agent: Create branches:

infra/devcontainer

infra/devdocs-mcp

pipelines/dagger-bootstrap

feat/agents-modularisation

Agent: Create directories:

.devcontainer, .vscode, tools/devdocs, tests, services, artifacts

Agent: Add /artifacts/ to .gitignore

4.2 Dev Container Setup
Agent: Create .devcontainer/devcontainer.json

json
Copy
Edit
{
  "name": "dagger-dev",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:1": {}
  },
  "postStartCommand": "pnpm install",
  "forwardPorts": [3000]
}
4.3 Dagger Pipeline Functions
Agent: Create src/pipeline/functions.ts

ts
Copy
Edit
import { container, Directory, CacheVolume, Secret } from "@dagger.io/dagger";

export function buildApp(src: Directory, npmCache: CacheVolume) {
  return container()
    .from("node:18-alpine")
    .withMountedDirectory("/app", src)
    .withWorkdir("/app")
    .withMountedCache("/root/.npm", npmCache)
    .withExec(["pnpm", "install"])
    .withExec(["pnpm", "run", "build"]);
}

export function testApp(app: ReturnType<typeof buildApp>) {
  return app.withExec(["pnpm", "run", "test"]);
}

export async function publish(app: ReturnType<typeof buildApp>, token: Secret) {
  await app
    .withRegistryAuth("ghcr.io", "x-access-token", token)
    .publish("ghcr.io/OWNER/REPO:${{git.sha}}");
}
4.4 Dagger Pipeline Entry Point
Agent: Create ci.dagger.ts

ts
Copy
Edit
import { Client } from "@dagger.io/dagger";
import { buildApp, testApp, publish } from "./src/pipeline/functions";

export default async function pipeline() {
  const client = new Client();
  const src    = client.host().directory(".");
  const cache  = client.cacheVolume("npm-cache");
  const ghTok  = client.host().envVariable("GHCR_TOKEN");

  const built  = buildApp(src, cache);
  const tested = testApp(built);
  await publish(tested, ghTok);
}

pipeline();
Human: Run locally via dagger run node ci.dagger.ts

4.5 GitHub Actions Wrapper
Agent: Create .github/workflows/ci.yml

yaml
Copy
Edit
name: dagger-ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v5
        with:
          module: ci.dagger.ts
    env:
      GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}
Human: Add GHCR_TOKEN secret to repository settings

Human: Push pipelines/dagger-bootstrap branch and validate CI job

4.6 DevDocs MCP Integration
Agent: Add DevDocs as submodule under tools/devdocs

Agent: Create tools/devdocs/crawl.sh

bash
Copy
Edit
#!/usr/bin/env bash
./crawler --url https://docs.dagger.io --output ./data
Human: Run crawl script and start server using docker compose up -d

Agent: Create .vscode/mcp.json

json
Copy
Edit
{
  "servers": [
    {
      "name": "dagger-docs",
      "url": "http://localhost:8080",
      "tools": ["searchDocs", "getPage"]
    }
  ]
}
Human: Test in Copilot Chat:
@dagger-docs.searchDocs "cache volumes"

4.7 Containerised Test Stack
Agent: Install testing dependencies:

bash
Copy
Edit
pnpm add -D jest ts-jest @types/jest @testcontainers/postgresql
Agent: Create:

tests/unit/example.spec.ts for unit tests

tests/integration/db.spec.ts using Testcontainers

tests/e2e/basic.spec.ts using Playwright

4.8 Preview Deploy with Dagger (Optional)
Agent: Extend publish() function to accept a preview mode

Agent: Implement preview deployment using Fly.io or local k3d cluster

Human: Add FLY_API_TOKEN to GitHub secrets

Human: Update GitHub workflow to conditionally run preview stage

4.9 Modularise AI Agents (Stretch Goal)
Agent: Move logic to services/agents/<agent-name>

Agent: Add buildAgent(name: string) function in Dagger

Agent: Run builds in parallel via client.parallel(...)

Agent: Add contract tests per agent

5. Merge Plan
Order	Branch	Criteria
1	infra/devcontainer	Dev container runs dagger run successfully
2	infra/devdocs-mcp	DevDocs server reachable, MCP usable in Copilot
3	pipelines/dagger-bootstrap	GHCR image pushed, CI pipeline passes
4	feat/agents-modularisation	Optional — agents modularised & tested

6. Final Notes
To begin implementation:

Complete all human steps in Sections 4.0, 4.5, and 4.6

Then tell Copilot Chat:
“Start working through Section 4.1 of TASKS.md”

To test pipeline locally:

bash
Copy
Edit
dagger run node ci.dagger.ts
This plan uses minimal YAML and maximum Dagger SDK to keep CI/CD logic in code and portable across dev and CI.