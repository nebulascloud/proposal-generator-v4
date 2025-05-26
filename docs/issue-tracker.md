# Proposal Generator V4: Issue Tracker & Task List

This document tracks the investigation and resolution of known issues in the proposal-generator-v4 workflow. Progress will be updated as fixes are implemented.

---

## Issue List & Task Progress

### 1. Duplicate Session Creation
- [x] **Diagnose why two sessions are created for each run**
- [x] **Identify where the second session is created in the codebase**
- [x] **Refactor to ensure only one session is created per workflow run**
- [ ] **Test and verify only one session is created per run**
- [ ] **Confirm fix in Monitor UI and with session metadata**

#### Details
- The second session's metadata:
  ```json
  {"currentPhase":"Phase4_Assembly","phaseStatus":"completed","lastUpdated":"2025-05-23T22:00:25.607Z","details":{"finalProposalFileId":{"type":"jsonContext","contextId":"cceba83a-b9b8-4872-92fb-8f4f44c50536"}}}
  ```
- The second session still appears as active in the Monitor UI.
- **Root cause:** responsesAgent.js was creating a new session if one did not exist for the proposalId, even though flowAgent.js already creates the session at the start of the workflow. This led to duplicate sessions.
- **Fix:** responsesAgent.js now throws an error if no session is found, enforcing that session creation is centralized in flowAgent.js.
- **Next:** Test and verify only one session is created per run, and confirm in the Monitor UI.

---

## How to Use This Document
- Each issue is tracked as a checklist.
- Progress is updated as each subtask is completed.
- Additional issues can be added as needed.

---

_Last updated: 2025-05-26_
