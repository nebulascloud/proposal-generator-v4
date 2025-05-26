# Proposal Generation Workflow (Text-Based Visual)

```text
[PHASE 1: Brief Analysis & Section Assignment]
┌─────────────────────────────────────────────────────────────────────────────┐
│ User: Submit Brief (UM)                                                     │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Brief Analysis (UM)                                              │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Section Assignments (UM + PM: Brief Analysis)                    │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 1: Clarifying Questions (Parallel Fork)]
┌─────────────────────────────────────────────────────────────────────────────┐
│ Assistant: For each Specialist Role (in parallel):                          │
│   ├─ Assistant: Specialist Qs (UM + PM: Brief, Analysis, Section Assignments)│
│   ├─ Assistant: Specialist Qs (UM + PM: ...)                                │
│   └─ ... (one per specialist)                                               │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Organize Questions (UM: All Specialist Qs)                       │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 2: Customer Q&A]
┌─────────────────────────────────────────────────────────────────────────────┐
│ User: Answer Organized Questions (UM)                                       │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Store Customer Answers (UM)                                      │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 2: Section Drafting (Parallel Fork)]
┌─────────────────────────────────────────────────────────────────────────────┐
│ Assistant: For each Section (in parallel):                                  │
│   ├─ Assistant: Draft Section (UM + PM: Brief, Analysis, Assignments,       │
│   │  Customer Answers)                                                      │
│   ├─ Assistant: Draft Section (UM + PM: ...)                                │
│   └─ ... (one per section)                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 3: Review & Revision (Parallel Forks)]
┌─────────────────────────────────────────────────────────────────────────────┐
│ Assistant: For each Section (in parallel):                                  │
│   ├─ Assistant: Review Section (UM + PM: Section Draft)                     │
│   ├─ Assistant: Review Section (UM + PM: ...)                               │
│   └─ ... (one per section)                                                  │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: For each Section (in parallel):                                  │
│   ├─ Assistant: Revise Section (UM + PM: Review)                            │
│   ├─ Assistant: Revise Section (UM + PM: ...)                               │
│   └─ ... (one per section)                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 3: Customer Review]
┌─────────────────────────────────────────────────────────────────────────────┐
│ User: Review Answers (UM)                                                   │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Store Customer Review Answers (UM)                               │
└─────────────────────────────────────────────────────────────────────────────┘

[PHASE 4: Final Approval & Assembly]
┌─────────────────────────────────────────────────────────────────────────────┐
│ Assistant: Final Approval (UM + PM: All previous)                           │
│   │                                                                         │
│   ▼                                                                         │
│ Assistant: Proposal Assembly (UM + PM: All previous)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Legend:**
- **User:** User message/input (UM)
- **Assistant:** Assistant message/output
- **UM:** Uses only user message(s) as input
- **PM:** Uses previous assistant message(s) as context via `previous_message_id`
- **Parallel Fork:** Steps run in parallel (e.g., per specialist or per section)
- **Phases:** Major workflow stages
