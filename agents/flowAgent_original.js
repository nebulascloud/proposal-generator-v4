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
    
    // Mock reviews using the new Quality Manager approach for test environment
    const reviews = {};
    sections.forEach(sec => {
      reviews[sec] = {
        review: 'Review feedback from the Quality Manager covering all aspects of the section including strategy, sales, technology, delivery, and commercial considerations.',
        customerQuestions: ['How do you plan to measure ROI?', 'What is your timeline for implementation?'],
        customerAnswers: 'Mock answers to review questions'
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
  
  // Step 6: QUALITY MANAGER REVIEW PROCESS - dedicated review, customer feedback, and revisions
  const reviews = {};
  const revisedDevelopment = {};

  // Post information about the review process starting
  await openai.beta.threads.messages.create(mainThread.id, {
    role: 'user',
    content: `We are now starting the review process where each section will be reviewed by our Quality Manager, followed by customer input and revisions from the original author.`
  });

  // Create Quality Manager assistant
  const qualityManagerId = await createAssistant('sp_Quality_Manager');

  // Process each section for review
  console.log("[flowAgent] Starting Quality Manager reviews");
  for (const [section, ownerRole] of Object.entries(assignments)) {
    const sectionTitle = section;
    const sectionContent = development[section];
    
    // Initialize reviews collection for this section
    reviews[section] = {
      review: '',
      customerQuestions: [],
      customerAnswers: ''
    };
    
    // Have the Quality Manager review each section
    console.log(`[flowAgent] Requesting Quality Manager review for "${section}"`);
    const qualityManagerReviewPrompt = `Please review the following section and provide feedback, suggested revisions, questions for the drafting agent, and questions for the customer. Only include customer questions if they are truly necessary or high-value.

    Title: ${sectionTitle}
    Content: ${sectionContent}

    Your feedback should include:
    1. General feedback on the section.
    2. Suggested revisions to improve the section.
    3. Questions for the drafting agent (${ownerRole.replace('sp_', '')}).
    4. Questions for the customer (only if high-value and essential).`;
    
    const qualityManagerReview = await getAssistantResponse(qualityManagerId, qualityManagerReviewPrompt, mainThread.id, { skipContextReminder: true });
    reviews[section].review = qualityManagerReview;
  }
  
  // Step 6B: Extract customer questions from Quality Manager reviews and get customer answers
  console.log("[flowAgent] Extracting customer questions from Quality Manager reviews");
  
  const allCustomerQuestions = {};
  for (const [section, reviewData] of Object.entries(reviews)) {
    // Have the orchestrator extract customer questions from the Quality Manager review
    const extractQuestionsPrompt = `From the following Quality Manager review for the "${section}" section, extract all questions intended for the customer. Only include high-value questions that would genuinely help improve the proposal.

Review:
${reviewData.review}

Return ONLY the list of unique, clear questions for the customer, numbered for reference. If there are no high-value questions for the customer, return "No questions for the customer."`;
    
    const extractedQuestions = await getAssistantResponse(orchestratorId, extractQuestionsPrompt, mainThread.id, { skipContextReminder: true });
    
    if (extractedQuestions.trim() && !extractedQuestions.includes("No questions")) {
      allCustomerQuestions[section] = extractedQuestions;
      reviews[section].customerQuestions = extractedQuestions.split('\n')
        .filter(q => q.trim())
        .map(q => q.replace(/^\d+\.?\s*/, '').trim());
    }
  }
  
  // If we have customer questions, send them to the customer
  if (Object.keys(allCustomerQuestions).length > 0) {
    console.log("[flowAgent] Sending review-generated questions to customer");
    
    let customerReviewQuestionsPrompt = `Based on our initial draft proposal, we have some follow-up questions to help us refine the content. Please provide answers to the following questions:\n\n`;
    
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
  console.log("[flowAgent] Authors revising sections based on Quality Manager feedback");
  
  for (const [section, ownerRole] of Object.entries(assignments)) {
    const authorId = await createAssistant(ownerRole);
    
    // Create revision prompt with all context
    const revisionPrompt = `Please revise your draft for the "${section}" section based on the Quality Manager's feedback and any customer answers to follow-up questions.

Original Draft:
${development[section]}

Quality Manager's Review:
${reviews[section].review}

${reviews[section].customerQuestions.length > 0 ? `
Customer's Answers to Follow-up Questions:
${reviews[section].customerAnswers}
` : 'No specific follow-up questions were asked of the customer for this section.'}

Please address the feedback and questions from the Quality Manager, and incorporate any insights from the customer's answers. Return a revised version of your section that addresses all the relevant feedback.`;
    
    console.log(`[flowAgent] Requesting revision of "${section}" from ${ownerRole}`);
    revisedDevelopment[section] = await getAssistantResponse(authorId, revisionPrompt, mainThread.id, { skipContextReminder: true });
  }
  
  // Step 7: Final Quality Manager review and approval
  console.log("[flowAgent] Requesting final review and approval");
  
  // Create a summary of all sections for the final review
  const sectionsForReview = Object.entries(revisedDevelopment).map(([section, content]) => 
    `## ${section}\n${content.substring(0, 300)}... (truncated)`
  ).join('\n\n');
  
  const finalReviewPrompt = `Please review all sections after revisions and provide final approval or any critical last recommendations.

Here are the revised sections (truncated for brevity):
${sectionsForReview}

Please provide your final approval if all sections now meet quality standards, or note any remaining critical issues that must be addressed.`;
  
  const approval = await getAssistantResponse(qualityManagerId, finalReviewPrompt, mainThread.id, { skipContextReminder: true });
  
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
