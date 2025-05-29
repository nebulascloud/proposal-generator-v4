// agents/flowSteps/flowPrompts.js
// Centralized prompt templates and instructions for the flow agent system.
// Grouped and documented by phase/sub-phase for maintainability and clarity.

// Define valid specialists directly in this file to avoid circular dependencies
// These must match the ones defined in assistantDefinitions.js
const PROMPT_VALID_SPECIALISTS = {
  SP_PROJECT_MANAGER: 'sp_Project_Manager',
  SP_BUSINESS_ANALYST: 'sp_Business_Analyst',
  SP_SOLUTION_ARCHITECT: 'sp_Solution_Architect', 
  SP_TECHNICAL_LEAD: 'sp_Technical_Lead',
  SP_ACCOUNT_MANAGER: 'sp_Account_Manager',
  SP_QUALITY_MANAGER: 'sp_Quality_Manager',
  SP_COLLABORATION_ORCHESTRATOR: 'sp_Collaboration_Orchestrator'
};

// Build a string of valid roles for prompts
const validSpecialistsString = Object.values(PROMPT_VALID_SPECIALISTS)
  .map(role => `- ${role}`)
  .join('\n');

// -------------------
// Phase 0: Initialization
// -------------------
const PHASE0 = {
  INIT_FLOW_SYSTEM: `You are the orchestrator for a multi-phase proposal generation flow. Your job is to initialize the flow, log the client brief, and ensure all subsequent steps have access to the jobId and contextId. Your response should be in JSON format.

JSON TEMPLATE:
{
  "status": "initialized",
  "jobId": "job123",
  "timestamp": "2023-09-01T12:00:00Z",
  "message": "Flow initialized successfully"
}`,
  // Add more initialization prompts as needed
};

// -------------------
// Phase 1: Brief Processing & Question Generation
// -------------------
const PHASE1 = {
  ANALYZE_BRIEF: `Analyze the provided customer brief thoroughly. Consider all aspects including business objectives, technical requirements, commercial aspects, and potential challenges. Provide a comprehensive assessment that will guide the proposal development process. 

IMPORTANT: Format your ENTIRE response as a valid JSON object with the structure shown below. Do not include any text outside the JSON structure.

JSON TEMPLATE:
{
  "summary": "Brief overview of the proposal",
  "businessObjectives": {
    "primaryGoals": ["Goal 1", "Goal 2"],
    "keyMetrics": ["Metric 1", "Metric 2"]
  },
  "technicalRequirements": {
    "infrastructure": ["Requirement 1", "Requirement 2"],
    "technologies": ["Technology 1", "Technology 2"],
    "integrations": ["Integration 1", "Integration 2"]
  },
  "stakeholders": ["Stakeholder 1", "Stakeholder 2"],
  "timeline": "Expected timeline details",
  "budgetConsiderations": "Budget information if available",
  "challenges": ["Challenge 1", "Challenge 2"],
  "opportunities": ["Opportunity 1", "Opportunity 2"]
}`,

  ASSIGN_PROPOSAL_SECTIONS: `Based on the analyzed brief, assign proposal sections and responsible specialists. 

IMPORTANT: Return ONLY a valid JSON object mapping each section name to exactly one role name. Your entire response must be valid JSON with no additional text.

CRITICAL: You must ONLY use the following valid specialist roles:
${validSpecialistsString}

JSON TEMPLATE:
{
  "Introduction": "${PROMPT_VALID_SPECIALISTS.SP_PROJECT_MANAGER}",
  "Business Objectives": "${PROMPT_VALID_SPECIALISTS.SP_BUSINESS_ANALYST}",
  "Technical Solution": "${PROMPT_VALID_SPECIALISTS.SP_SOLUTION_ARCHITECT}",
  "Implementation Plan": "${PROMPT_VALID_SPECIALISTS.SP_PROJECT_MANAGER}",
  "Cost Analysis": "${PROMPT_VALID_SPECIALISTS.SP_ACCOUNT_MANAGER}"
}`,

  ASSIGN_PROPOSAL_SECTIONS_WITH_SECTIONS: `Based on the brief and analysis, assign these sections: {sections}.

IMPORTANT: You must ONLY use the valid specialist roles listed below. Return a valid JSON object mapping each section name to exactly one role name. Format your entire response as proper JSON with no additional text.

VALID SPECIALIST ROLES:
${validSpecialistsString}

JSON TEMPLATE:
{
  "Introduction": "${PROMPT_VALID_SPECIALISTS.SP_PROJECT_MANAGER}",
  "Business Objectives": "${PROMPT_VALID_SPECIALISTS.SP_BUSINESS_ANALYST}",
  "Technical Solution": "${PROMPT_VALID_SPECIALISTS.SP_SOLUTION_ARCHITECT}"
}`,

  GENERATE_SPECIALIST_QUESTIONS: `As the {role}, generate 3-5 important strategic clarifying questions for the proposal based on the brief and analysis. 

IMPORTANT: Format your ENTIRE response as a valid JSON array of question objects as shown in the template below. Each question object must include the fields shown. Your response must be properly formatted JSON with no additional text.

JSON TEMPLATE:
[
  {
    "question": "What is the primary business objective this proposal should address?",
    "importance": "high",
    "rationale": "Understanding the core objective ensures alignment"
  },
  {
    "question": "What is the expected timeline for implementation?",
    "importance": "medium",
    "rationale": "Helps with resource planning and deliverables"
  },
  {
    "question": "Are there any regulatory considerations we should be aware of?",
    "importance": "high",
    "rationale": "Ensures compliance and reduces risk"
  }
]`,

  ORGANIZE_ALL_QUESTIONS: `Organize and deduplicate the following specialist questions for the proposal. 

IMPORTANT: Return a JSON object grouping questions by theme. Your ENTIRE response must be a valid, properly-formatted JSON object with no additional text.

Questions: {allQuestions}

JSON TEMPLATE:
{
  "Financials": [
    { "question": "What is your budget?", "source": "${PROMPT_VALID_SPECIALISTS.SP_ACCOUNT_MANAGER}", "id": "q1" },
    { "question": "What is your timeline?", "source": "${PROMPT_VALID_SPECIALISTS.SP_PROJECT_MANAGER}", "id": "q2" }
  ],
  "Technical": [
    { "question": "What are your key technical requirements?", "source": "${PROMPT_VALID_SPECIALISTS.SP_TECHNICAL_LEAD}", "id": "q3" }
  ]
}`,

  // Example JSON template for organized/deduped questions:
  ORGANIZED_QUESTIONS_TEMPLATE: {
    "Financials": [
      { "question": "What is your budget?", "source": PROMPT_VALID_SPECIALISTS.SP_ACCOUNT_MANAGER, "id": "q1" },
      { "question": "What is your timeline?", "source": PROMPT_VALID_SPECIALISTS.SP_PROJECT_MANAGER, "id": "q2" }
    ],
    "Technical": [
      { "question": "What are your key technical requirements?", "source": PROMPT_VALID_SPECIALISTS.SP_TECHNICAL_LEAD, "id": "q3" }
    ]
  }
  // Add more prompts as needed for Phase 1
};

// -------------------
// Future Phases (Phase 2+): Add as you implement
// -------------------
const PHASE2 = {
  // Example:
  // DRAFT_PROPOSAL: `Using the answers to all questions and the brief, draft the full proposal...`,
};

// Export grouped prompts for easy import in phase helpers
module.exports = {
  PHASE0,
  PHASE1,
  PHASE2,
  validSpecialistsString
};
