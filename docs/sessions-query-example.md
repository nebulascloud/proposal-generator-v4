# Database Query Example: Sessions Table

This document provides a simple example of querying the `sessions` table in the proposal-generator-v4 database. This can be useful for debugging, analytics, or verifying session data during workflow development.

---

## Example Query

```sql
SELECT * FROM "sessions" LIMIT 100;
```

- **Purpose:** Fetches the first 100 rows from the `sessions` table.
- **Usage:** Run this query in your SQL client or database console to inspect recent session records.

---

## Context
- The `sessions` table stores information about user/assistant interactions, workflow progress, and session metadata.
- Useful for:
  - Debugging session creation and duplication issues
  - Verifying session data after workflow changes
  - Auditing user/assistant message history

---

## Related Files
- `db/models/session.js`: ORM/model definition for sessions
- `agents/flowAgent.js`: Handles session creation and workflow logic

---

For more details on the workflow and session management, see [workflow-visual.md](workflow-visual.md).
