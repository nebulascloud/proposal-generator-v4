require('dotenv').config();
const { defaultTemplate } = require('../templates/defaultTemplate');
const { OpenAI } = require('openai');
const { assignSections } = require('./orchestratorAgent');
const { createAssistant, getAssistantResponse, initializeThread } = require('./assistantAgent');
const { assistantDefinitions } = require('./assistantDefinitions');

// Mock customer agent
function mockCustomerAnswer(question, brief) {
  return `Mock answer to "${question}" for ${brief.client_name}`;
}

async function runFullFlow({ brief }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const analysis = `Brief analysis for ${brief.client_name}`;
    const sections = Object.keys(defaultTemplate);
    const assignments = await assignSections({ sections, title: '', client: brief.client_name, details: brief.project_description });
    
    // New format for questions - organized by themes
    const organizedQuestions = {
      organizedQuestions: [
        {
          theme: "Business Objectives",
          questions: [
            {
              question: "What are your primary business goals for this project?",
              source: "sp_Account_Manager",
              id: "q1"
            },
            {
              question: "How do you measure success for this initiative?",
              source: "sp_Commercial_Manager",
              id: "q2"
            }
          ]
        },
        {
          theme: "Technical Requirements",
          questions: [
            {
              question: "What are your existing systems that need integration?",
              source: "sp_Solution_Architect",
              id: "q3"
            }
          ]
        }
      ]
    };
    
    // Single comprehensive answer from customer
    const customerAnswers = `Here are my answers to your questions:

## Business Objectives
q1. Our primary business goals are to improve data quality and customer experience.
q2. We measure success through reduced errors and improved customer satisfaction scores.

## Technical Requirements
q3. We need integration with our Oracle ERP system and Salesforce CRM.`;
    
    // Store questions and answers in consistent format
    const questionsAndAnswers = {
      organizedQuestions,
      customerAnswers
    };
    
    const development = {};
    for (const section of sections) {
      development[section] = `Draft for ${section} incorporating all customer answers about business objectives and technical requirements.`;
    }
    
    // Mock reviews from different assistants for test environment
    const reviews = {};
    sections.forEach(sec => {
      reviews[sec] = {
        round1: {
          'sp_Account_Manager': 'Review comment from Account Manager',
          'sp_Solution_Architect': 'Review comment from Solution Architect',
          'sp_Commercial_Manager': 'Review comment from Commercial Manager'
        },
        customerQuestions: ['How do you plan to measure ROI?', 'What is your timeline for implementation?'],
        customerAnswers: 'Mock answers to review questions',
        round2: {
          'sp_Account_Manager': 'Follow-up review from Account Manager',
          'sp_Solution_Architect': 'Follow-up review from Solution Architect',
          'sp_Commercial_Manager': 'Follow-up review from Commercial Manager'
        }
      };
    });
    
    // Mock revised content
    const revisedDevelopment = {};
    sections.forEach(sec => {
      revisedDevelopment[sec] = `Revised draft for ${sec} after incorporating feedback and customer answers.`;
    });
    
    const approval = 'Final approval granted';
    const assembled = sections.map(sec => revisedDevelopment[sec]).join('\n\n');
    return { 
      analysis, 
      sections, 
      assignments, 
      questionsAndAnswers, 
      development, 
      reviews, 
      revisedDevelopment,
      approval, 
      assembled 
    };
  }
  // Production: orchestrate via assistants
  const sections = Object.keys(defaultTemplate);

  // Create and initialize a single thread for the entire flow with comprehensive context
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const mainThread = await initializeThread(brief);
  console.log("[flowAgent] Created and initialized main flow thread " + mainThread.id);
  
  // Get available roles for the orchestrator
  const availableRoles = Object.keys(assistantDefinitions);
  console.log("[flowAgent] Available roles: " + availableRoles.join(', '));
  
  // Create orchestration assistant
  const orchestratorId = await createAssistant('sp_Collaboration_Orchestrator');
  
  // Step 1: analysis - no need to include the brief again since it's in the thread context
  const analysisPrompt = "Analyze the previously provided brief and provide a comprehensive assessment.";
  const analysis = await getAssistantResponse(orchestratorId, analysisPrompt, mainThread.id, { skipContextReminder: true });
  
  // JSON parse helper
  function parseJson(raw, label) {
    console.log(`[flowAgent] Raw ${label}:`, raw);
    if (typeof raw !== 'string') {
      console.error(`[flowAgent] Non-string response for ${label}:`, raw);
      throw new Error(`No JSON response for ${label}`);
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'undefined') {
      console.error(`[flowAgent] Undefined or empty response for ${label}`);
      throw new Error(`No JSON response for ${label}`);
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first < 0 || last < first) {
      console.error(`[flowAgent] JSON object not found in ${label} response`);
      throw new Error(`Invalid JSON for ${label}`);
    }
    const jsonStr = trimmed.substring(first, last + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error(`[flowAgent] JSON.parse error for ${label}:`, e.message);
      throw new Error(`Invalid JSON for ${label}`);
    }
  }
  
  // Step 2: assign sections - specify ONLY available roles
  const assignPrompt = "Assign these sections: " + sections.join(', ') + 
                        " based on the brief information already provided.\n\n" +
                        "IMPORTANT: You must ONLY use these exact roles in your assignments: " + 
                        availableRoles.join(', ') + 
                        "\n\nReturn a JSON object mapping each section name to exactly one of these role names.";
  
  const assignRaw = await getAssistantResponse(orchestratorId, assignPrompt, mainThread.id, { skipContextReminder: true });
  const assignments = parseJson(assignRaw, 'section assignments');
  
  // Step 3: Each specialist generates clarifying questions about the entire brief
  console.log("[flowAgent] Starting new question generation workflow");
  
  // Get all service provider roles, excluding orchestrator and customer
  const specialistRoles = Object.keys(assistantDefinitions).filter(role => 
    role.startsWith('sp_') && !role.includes('Collaboration_Orchestrator')
  );
  console.log(`[flowAgent] Identified ${specialistRoles.length} specialist roles for question generation`);
  
  // Have each specialist generate questions
  const allQuestions = [];
  for (const role of specialistRoles) {
    const specialistId = await createAssistant(role);
    const questionPrompt = `As a ${role.replace('sp_', '')}, review the customer brief and generate 2-3 important strategic clarifying questions that would help you better understand the customer's needs and provide an expert proposal. 
    
Your questions should:
- Be relevant to your specific expertise and role
- Focus on understanding business needs, constraints, and priorities
- NOT ask how to write or structure the proposal
- NOT ask section-specific questions
- Demonstrate your expertise in your domain

Return your questions as a JSON array in this format:
[
  {
    "question": "Your first question text here",
    "rationale": "Brief explanation of why this question is important from your role's perspective",
    "category": "General topic/category for this question (e.g., 'Technical Requirements', 'Timeline', 'Business Objectives')"
  },
  ...more questions...
]`;
    
    console.log(`[flowAgent] Requesting questions from ${role}`);
    const rawResponse = await getAssistantResponse(specialistId, questionPrompt, mainThread.id, { skipContextReminder: true });
    
    // Parse specialist questions
    try {
      const responseStr = rawResponse.trim();
      const jsonStartIdx = responseStr.indexOf('[');
      const jsonEndIdx = responseStr.lastIndexOf(']') + 1;
      
      if (jsonStartIdx >= 0 && jsonEndIdx > jsonStartIdx) {
        const jsonStr = responseStr.substring(jsonStartIdx, jsonEndIdx);
        const specialistQuestions = JSON.parse(jsonStr);
        
        // Add role information to each question
        specialistQuestions.forEach(q => {
          q.role = role;
          allQuestions.push(q);
        });
        
        console.log(`[flowAgent] Added ${specialistQuestions.length} questions from ${role}`);
      } else {
        console.error(`[flowAgent] Could not find valid JSON in response from ${role}`);
      }
    } catch (e) {
      console.error(`[flowAgent] Error parsing questions from ${role}:`, e);
    }
  }
  
  console.log(`[flowAgent] Collected ${allQuestions.length} questions from all specialists`);
  
  // Step 3B: Have orchestrator deduplicate and organize questions
  const dedupePrompt = `I've collected clarifying questions from various specialists regarding the customer brief. 
Please review these questions, remove duplicates or very similar questions, and organize them into logical groups or themes.

Format the final questions in a clear, organized manner that would be easy for the customer to respond to.

Here are all the questions:
${JSON.stringify(allQuestions, null, 2)}

Return the organized questions as a JSON object with the following structure:
{
  "organizedQuestions": [
    {
      "theme": "Theme/Category Name",
      "questions": [
        {
          "question": "The question text",
          "source": "Original role that suggested this question",
          "id": "q1" // Assign a simple ID to each question
        },
        ...more questions in this theme...
      ]
    },
    ...more themes...
  ]
}`;

  console.log("[flowAgent] Requesting question deduplication and organization");
  const organizedQuestionsRaw = await getAssistantResponse(orchestratorId, dedupePrompt, mainThread.id, { skipContextReminder: true });
  const organizedQuestions = parseJson(organizedQuestionsRaw, 'organized questions');
  
  // Step 4: Ask all questions at once to the customer
  const customerId = await createAssistant('cst_Customer');
  
  // Format questions for customer in a readable format
  let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\n\n`;
  
  organizedQuestions.organizedQuestions.forEach((theme, themeIndex) => {
    customerPrompt += `\n## ${theme.theme}\n\n`;
    theme.questions.forEach((q, qIndex) => {
      customerPrompt += `${q.id}. ${q.question}\n`;
    });
  });
  
  customerPrompt += `\n\nPlease provide thorough answers to each question. You may organize your response by theme or answer each question individually by referencing its ID.`;
  
  console.log("[flowAgent] Sending consolidated questions to customer");
  const customerAnswers = await getAssistantResponse(customerId, customerPrompt, mainThread.id, { skipContextReminder: true });
  
  console.log("[flowAgent] Received comprehensive answers from customer");
  
  // Store all questions and answers in a consistent format for the rest of the flow
  const questionsAndAnswers = {
    organizedQuestions,
    customerAnswers
  };
  
  // Step 5: development by assignees using thread context that includes all Q&A
  const development = {};
  
  // First, post a summary message to the thread about the Q&A process
  await openai.beta.threads.messages.create(mainThread.id, { 
    role: 'user', 
    content: `The customer has provided answers to our clarifying questions. Please consider this information when drafting your sections. The Q&A exchange covered key topics including: ${organizedQuestions.organizedQuestions.map(t => t.theme).join(', ')}.` 
  });
  
  // Now have each specialist draft their assigned sections
  for (const [section, role] of Object.entries(assignments)) {
    // Map role to available assistant if needed
    const aid = await createAssistant(role);
    // Use focused prompt that relies on thread context with full Q&A
    const prompt = `Draft the "${section}" section of the proposal based on:
1. The initial project brief
2. The clarifying questions and customer answers now in the thread
3. Your expertise as a ${role.replace('sp_', '')}

Your draft should be well-structured, persuasive, and demonstrate expert understanding of the customer's needs. Focus on providing value and addressing the customer's specific requirements as revealed through the Q&A process.`;
    
    console.log(`[flowAgent] Requesting draft for "${section}" from ${role}`);
    development[section] = await getAssistantResponse(aid, prompt, mainThread.id, { skipContextReminder: true });
  }
  
  // Step 6: ENHANCED REVIEW PROCESS - multi-assistant reviews, customer feedback, and revisions
  const reviews = {};
  const revisedDevelopment = {};

  // Function to get all specialists except the section owner
  function getReviewingSpecialists(sectionOwner) {
    return specialistRoles.filter(role => 
      role !== sectionOwner && role !== 'cst_Customer' && !role.includes('Collaboration_Orchestrator')
    );
  }

  // Post information about the review process starting
  await openai.beta.threads.messages.create(mainThread.id, {
    role: 'user',
    content: `We are now starting the collaborative review process where each section will be reviewed by multiple specialists, followed by customer input and revisions from the original author.`
  });

  // Process each section for FIRST ROUND of reviews
  console.log("[flowAgent] Starting first round of section reviews");
  for (const [section, ownerRole] of Object.entries(assignments)) {
    const sectionTitle = section;
    const sectionContent = development[section];
    
    // Initialize reviews collection for this section
    reviews[section] = {
      round1: {},
      customerQuestions: [],
      customerAnswers: '',
      round2: {}
    };
    
    // FIRST: Have the orchestrator review to start the process
    console.log(`[flowAgent] Requesting orchestrator review for "${section}"`);
    const orchestratorReviewPrompt = `Please review the following section and provide feedback, suggested revisions, questions for the drafting agent, and questions for the customer. As the first reviewer, establish a foundation for others to build upon.

    Title: ${sectionTitle}
    Content: ${sectionContent}

    Your feedback should include:
    1. General feedback on the section.
    2. Suggested revisions to improve the section.
    3. Questions for the drafting agent (${ownerRole.replace('sp_', '')}).
    4. Questions for the customer.`;
    
    const orchestratorReview = await getAssistantResponse(orchestratorId, orchestratorReviewPrompt, mainThread.id, { skipContextReminder: true });
    reviews[section].round1['sp_Collaboration_Orchestrator'] = orchestratorReview;
    
    // THEN: Have each specialist (except the owner) review the section
    const reviewingSpecialists = getReviewingSpecialists(ownerRole);
    for (const reviewerRole of reviewingSpecialists) {
      const reviewerId = await createAssistant(reviewerRole);
      
      console.log(`[flowAgent] Requesting ${reviewerRole} review for "${section}"`);
      const reviewPrompt = `Please review the following section and provide feedback, suggested revisions, questions for the drafting agent, and questions for the customer. Pay attention to the other assistants' review comments in the chat and don't repeat the same feedback, suggested revisions, or questions.

    Title: ${sectionTitle}
    Content: ${sectionContent}

    Your feedback should include:
    1. General feedback on the section.
    2. Suggested revisions to improve the section.
    3. Questions for the drafting agent (${ownerRole.replace('sp_', '')}).
    4. Questions for the customer.`;
      
      const review = await getAssistantResponse(reviewerId, reviewPrompt, mainThread.id, { skipContextReminder: true });
      reviews[section].round1[reviewerRole] = review;
    }
  }
  
  // Step 6B: Extract customer questions from reviews and get customer answers
  console.log("[flowAgent] Extracting customer questions from reviews");
  
  const allCustomerQuestions = {};
  for (const [section, reviewData] of Object.entries(reviews)) {
    // Have the orchestrator extract and organize customer questions from the reviews
    const reviewContent = Object.entries(reviewData.round1)
      .map(([role, review]) => `${role.replace('sp_', '')}'s Review:\n${review}`)
      .join('\n\n');
    
    const extractQuestionsPrompt = `From the following review comments for the "${section}" section, extract all questions intended for the customer. Organize these questions, removing duplicates and similar questions.

Review comments:
${reviewContent}

Return ONLY the list of unique, clear questions for the customer, numbered for reference.`;
    
    const extractedQuestions = await getAssistantResponse(orchestratorId, extractQuestionsPrompt, mainThread.id, { skipContextReminder: true });
    
    if (extractedQuestions.trim()) {
      allCustomerQuestions[section] = extractedQuestions;
      reviews[section].customerQuestions = extractedQuestions.split('\n')
        .filter(q => q.trim())
        .map(q => q.replace(/^\d+\.?\s*/, '').trim());
    }
  }
  
  // If we have customer questions, send them to the customer
  if (Object.keys(allCustomerQuestions).length > 0) {
    console.log("[flowAgent] Sending review-generated questions to customer");
    
    let customerReviewQuestionsPrompt = `Based on our initial draft proposal, our team has some follow-up questions to help us refine the content. Please provide answers to the following questions:\n\n`;
    
    for (const [section, questions] of Object.entries(allCustomerQuestions)) {
      customerReviewQuestionsPrompt += `\n## Questions regarding the "${section}" section:\n${questions}\n`;
    }
    
    customerReviewQuestionsPrompt += `\n\nYour answers will help us refine the proposal to better meet your needs.`;
    
    const customerReviewAnswers = await getAssistantResponse(customerId, customerReviewQuestionsPrompt, mainThread.id, { skipContextReminder: true });
    
    // Store customer answers in the reviews object
    for (const section of Object.keys(allCustomerQuestions)) {
      reviews[section].customerAnswers = customerReviewAnswers;
    }
    
    // Add customer answers to the thread for context
    await openai.beta.threads.messages.create(mainThread.id, {
      role: 'user',
      content: `The customer has provided answers to our review-generated questions. These answers should be considered during the revision process.`
    });
  }
  
  // Step 6C: Have original authors revise their sections based on feedback and customer answers
  console.log("[flowAgent] Authors revising sections based on feedback");
  
  for (const [section, ownerRole] of Object.entries(assignments)) {
    const authorId = await createAssistant(ownerRole);
    
    // Compile all the review feedback
    const reviewSummary = Object.entries(reviews[section].round1)
      .map(([role, review]) => `${role.replace('sp_', '')}'s Review:\n${review}`)
      .join('\n\n');
    
    // Create revision prompt with all context
    const revisionPrompt = `Please revise your draft for the "${section}" section based on the feedback received and the customer's answers to follow-up questions.

Original Draft:
${development[section]}

Review Feedback:
${reviewSummary}

${reviews[section].customerQuestions.length > 0 ? `
Customer's Answers to Follow-up Questions:
${reviews[section].customerAnswers}
` : 'No specific follow-up questions were asked of the customer for this section.'}

Please address the feedback and questions from other specialists, and incorporate any insights from the customer's answers. Return a revised version of your section that addresses all the relevant feedback.`;
    
    console.log(`[flowAgent] Requesting revision of "${section}" from ${ownerRole}`);
    revisedDevelopment[section] = await getAssistantResponse(authorId, revisionPrompt, mainThread.id, { skipContextReminder: true });
  }
  
  // Step 6D: SECOND ROUND of reviews on the revised content
  console.log("[flowAgent] Starting second round of section reviews");
  
  for (const [section, ownerRole] of Object.entries(assignments)) {
    // Have each specialist (except the owner) review the REVISED section
    const reviewingSpecialists = getReviewingSpecialists(ownerRole);
    
    for (const reviewerRole of reviewingSpecialists) {
      const reviewerId = await createAssistant(reviewerRole);
      
      console.log(`[flowAgent] Requesting ${reviewerRole} second review for "${section}"`);
      const secondReviewPrompt = `Please review the REVISED version of the "${section}" section. Confirm whether your previous feedback has been addressed and provide any final suggestions.

Original feedback summary:
${reviews[section].round1[reviewerRole] || "You didn't provide feedback on the first draft of this section."}

Revised content:
${revisedDevelopment[section]}

Please keep your response brief, focusing on:
1. Has your feedback been adequately addressed? (Yes/No)
2. Any critical remaining issues that MUST be fixed (if any)
3. Minor suggestions that could further improve the section (optional)`;
      
      const secondReview = await getAssistantResponse(reviewerId, secondReviewPrompt, mainThread.id, { skipContextReminder: true });
      reviews[section].round2[reviewerRole] = secondReview;
    }
  }
  
  // Step 7: Final orchestrator review and approval
  console.log("[flowAgent] Requesting final review and approval from orchestrator");
  
  // Compile all second-round feedback for the orchestrator's consideration
  const finalFeedbackSummary = {};
  for (const [section, reviewData] of Object.entries(reviews)) {
    finalFeedbackSummary[section] = Object.entries(reviewData.round2)
      .map(([role, review]) => `${role.replace('sp_', '')}: ${review}`)
      .join('\n');
  }
  
  const finalReviewPrompt = `Please review all sections after revisions and provide final approval or any critical last recommendations.

Feedback summary from the second review round:
${Object.entries(finalFeedbackSummary).map(([section, feedback]) => 
  `## ${section}\n${feedback}`
).join('\n\n')}

If all critical issues have been addressed, please provide your final approval.`;
  
  const approval = await getAssistantResponse(orchestratorId, finalReviewPrompt, mainThread.id, { skipContextReminder: true });
  
  // Step 8: Final assembly using the REVISED sections
  const assembled = sections.map(sec => revisedDevelopment[sec]).join('\n\n');
  const finalAssemblyPrompt = "Finalize the complete proposal by assembling and harmonizing the following revised sections into a cohesive document:\n\n" + assembled;
  const final = await getAssistantResponse(orchestratorId, finalAssemblyPrompt, mainThread.id, { skipContextReminder: true });
  
  console.log("[flowAgent] Completed enhanced review flow using thread " + mainThread.id);
  return { 
    analysis, 
    assignments, 
    questionsAndAnswers, 
    development, 
    reviews, 
    revisedDevelopment,
    approval, 
    assembled: final || assembled
  };
}

module.exports = { runFullFlow };
