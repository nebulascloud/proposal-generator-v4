// agents/flowSteps/flowPrompts.js
// Centralized prompt templates and instructions for the flow agent system.
// Grouped and documented by phase/sub-phase for maintainability and clarity.

const { getAssignableSpecialistsString, getAssignableSpecialists } = require('../assistantDefinitions');

// Get the formatted string of assignable specialist roles for prompts
const validSpecialistsString = getAssignableSpecialistsString();

// Get a few example assignable specialist roles for prompt templates
const assignableSpecialists = getAssignableSpecialists();
const exampleAssignableRole1 = assignableSpecialists.length > 0 ? assignableSpecialists[0] : 'sp_Example_Specialist_1';
const exampleAssignableRole2 = assignableSpecialists.length > 1 ? assignableSpecialists[1] : 'sp_Example_Specialist_2';
const exampleAssignableRole3 = assignableSpecialists.length > 2 ? assignableSpecialists[2] : 'sp_Example_Specialist_3';


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

JSON TEMPLATE (example section names and roles):
{
  "Introduction": "${exampleAssignableRole1}",
  "Business Objectives": "${exampleAssignableRole2}",
  "Technical Solution": "${exampleAssignableRole3}",
  "Implementation Plan": "${exampleAssignableRole1}",
  "Cost Analysis": "${exampleAssignableRole2}"
}`,

  ASSIGN_PROPOSAL_SECTIONS_WITH_SECTIONS: `Based on the brief and analysis, assign specialist roles to the following proposal sections: {sections}.

IMPORTANT: You must ONLY use the valid specialist roles listed below. Return a valid JSON object mapping each provided section name to exactly one role name. Ensure your entire response is a single, valid JSON object with no additional text outside of it.

VALID SPECIALIST ROLES:
${validSpecialistsString}

EXAMPLE JSON RESPONSE (using the provided sections):
If sections were "Executive Summary, Technical Approach, Project Plan", your response should look like:
{
  "Executive Summary": "${exampleAssignableRole1}",
  "Technical Approach": "${exampleAssignableRole2}",
  "Project Plan": "${exampleAssignableRole1}"
}`,

  GENERATE_SPECIALIST_QUESTIONS: `As the {role}, generate 3-5 important strategic clarifying questions for the proposal based on the brief and analysis. 

IMPORTANT: Format your ENTIRE response as a valid JSON object. This object must contain a single key named "questions", and its value must be a JSON array of question objects as shown in the template below. Each question object in the array must include the fields shown. Your response must be properly formatted JSON with no additional text outside the main JSON object.

JSON TEMPLATE:
{
  "questions": [
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
  ]
}`,

  ORGANIZE_ALL_QUESTIONS: `Organize, deduplicate, and merge the following specialist questions for the proposal.

Your task:
1. Group questions by theme (Financials, Technical, etc.)
2. MERGE similar questions into a single comprehensive question
3. When merging questions, combine all sources into an array
4. Create a clear, well-formulated question that captures all aspects from the original questions
5. Ensure no important details are lost when merging questions (i.e. Do NOT summarise, lose, or drop any questions)
6. Your goal is to ensure that the same question is not asked multiple times, but all relevant information is captured in the final merged question.

IMPORTANT: Return a JSON object grouping questions by theme. Your ENTIRE response must be a valid, properly-formatted JSON object with no additional text.

Questions: {allQuestions}

JSON TEMPLATE (example themes, questions, and source roles):
{
  "Financials": [
    { 
      "question": "What is your budget range and what financial constraints or considerations should we be aware of?", 
      "sources": ["${exampleAssignableRole1}", "${exampleAssignableRole2}"],
      "id": "q1" 
    },
    { 
      "question": "What is your expected timeline for implementation and key financial milestones?", 
      "sources": ["${exampleAssignableRole1}"], 
      "id": "q2" 
    }
  ],
  "Technical": [
    { 
      "question": "What are your key technical requirements, including integration needs and performance expectations?", 
      "sources": ["${exampleAssignableRole3}", "${exampleAssignableRole2}"], 
      "id": "q3" 
    }
  ]
}`,

  // Example JSON template for organized/deduped questions:
  ORGANIZED_QUESTIONS_TEMPLATE: {
    "Financials": [
      { "question": "What is your budget range and financial constraints?", "sources": [exampleAssignableRole1, exampleAssignableRole2], "id": "q1" },
      { "question": "What is your implementation timeline and key milestones?", "sources": [exampleAssignableRole1], "id": "q2" }
    ],
    "Technical": [
      { "question": "What are your key technical requirements and integration needs?", "sources": [exampleAssignableRole3, exampleAssignableRole2], "id": "q3" }
    ]
  },
  
  // Sequential mode specific prompt - provides context about previous questions
  GENERATE_SPECIALIST_QUESTIONS_SEQUENTIAL: `As the {role}, generate 3-5 important strategic clarifying questions for the proposal based on the brief and analysis. 

IMPORTANT: You have been provided with questions that other specialists have already asked. AVOID ASKING DUPLICATE OR SIMILAR QUESTIONS. Focus on generating questions that are UNIQUE to your expertise and perspective that other specialists have not already covered.

PREVIOUS QUESTIONS:
{previousQuestions}

IMPORTANT: Format your ENTIRE response as a valid JSON object. This object must contain a single key named "questions", and its value must be a JSON array of question objects as shown in the template below. Each question object in the array must include the fields shown. Your response must be properly formatted JSON with no additional text outside the main JSON object.

JSON TEMPLATE:
{
  "questions": [
    {
      "question": "What specific aspect of [your expertise area] should we focus on?",
      "importance": "high",
      "rationale": "This addresses a unique area not covered by other specialists"
    }
  ]
}`
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
  validSpecialistsString // Export the dynamically generated string from assistantDefinitions
};
