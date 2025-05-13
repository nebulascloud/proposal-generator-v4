require('dotenv').config();
const { defaultTemplate } = require('../templates/defaultTemplate');
const { OpenAI } = require('openai');
const { assignSections } = require('./orchestratorAgent');

// Mock customer agent
function mockCustomerAnswer(question, brief) {
  return `Mock answer to "${question}" for ${brief.client_name}`;
}

async function runFullFlow({ brief }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const analysis = `Brief analysis for ${brief.client_name}`;
    const sections = Object.keys(defaultTemplate);
    const assignments = await assignSections({ sections, title: '', client: brief.client_name, details: brief.project_description });
    const questions = sections.map(s => `What additional details do you have for "${s}"?`);
    const answers = questions.map(q => mockCustomerAnswer(q, brief));
    const development = {};
    for (const section of sections) {
      development[section] = `Draft for ${section} incorporating answers: ${answers.join('; ')}`;
    }
    const reviews = {};
    sections.forEach(sec => {
      reviews[sec] = `Review comment for ${sec}`;
    });
    const approval = 'Final approval granted';
    const assembled = sections.map(sec => development[sec]).join('\n\n');
    return { analysis, sections, assignments, questions, answers, development, reviews, approval, assembled };
  }
  // Production implementation using OpenAI SDK
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || 'gpt-4';

  // Step 1: Analyze brief
  const analysisResp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'Provide a concise analysis of the customer brief.' },
      { role: 'user', content: JSON.stringify(brief) }
    ]
  });

  const analysis = analysisResp.choices[0].message.content.trim();
  // Step 2: Assign sections
  const sections = Object.keys(defaultTemplate);
  const assignments = await assignSections({ sections, title: brief.title, client: brief.client_name, details: brief.project_description });
  // Step 3: Generate questions for additional details
  const questions = [];
  for (const section of sections) {
    const qResp = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: `You are a customer liaison. Ask one question to clarify details for the section: ${section}.` }]
    });
    questions.push(qResp.choices[0].message.content.trim());
  }
  // Step 4: Draft each section
  const development = {};
  for (const section of sections) {
    const draftResp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `You are a proposal writer. Draft the ${section} section based on the brief and customer answers.` },
        { role: 'user', content: `Brief: ${JSON.stringify(brief)}` },
        { role: 'user', content: `Question: ${questions[sections.indexOf(section)]}` }
      ]
    });
    development[section] = draftResp.choices[0].message.content.trim();
  }
  // Step 5: Review each section
  const reviews = {};
  for (const section of sections) {
    const reviewResp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `You are a quality reviewer. Provide feedback on the following ${section} draft.` },
        { role: 'user', content: development[section] }
      ]
    });
    reviews[section] = reviewResp.choices[0].message.content.trim();
  }
  // Step 6: Final approval and assembly
  const assembled = sections.map(sec => development[sec]).join('\n\n');
  const approvalResp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are an executive. Provide final approval comments on the assembled proposal.' },
      { role: 'user', content: assembled }
    ]
  });
  const approval = approvalResp.choices[0].message.content.trim();
  return { analysis, sections, assignments, questions, development, reviews, approval, assembled };
}

module.exports = { runFullFlow };
