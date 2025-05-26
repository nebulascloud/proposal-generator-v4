// Ensure test environment before requiring app
process.env.NODE_ENV = 'test';
const { resetDatabase } = require('../db/setup');

const request = require('supertest');
const app = require('../index'); // Assuming index.js sets up the express app and routes
const { customerBrief } = require('./fixtures/customerBrief');
const { defaultTemplate } = require('../templates/defaultTemplate');
const responsesAgent = require('../agents/responsesAgent'); // Import to access the mocked module

// Mock responsesAgent
jest.mock('../agents/responsesAgent', () => ({
  resetProgress: jest.fn(),
  createAndUploadFile: jest.fn(),
  createInitialResponse: jest.fn(),
  forkResponse: jest.fn(),
  downloadFileContent: jest.fn(), // Kept for completeness, though not directly used by flowAgent
  trackTokenUsage: jest.fn(),
  updateProgressStatus: jest.fn(),
  getTokenUsageReport: jest.fn(),
}));

describe('POST /agents/flow', () => {
  const sections = Object.keys(defaultTemplate);

  // Mock data
  const mockBriefAnalysis = `This is an analysis of the brief for ${customerBrief.client_name}.`;
  
  const mockSectionAssignmentsObj = {};
  sections.forEach(s => mockSectionAssignmentsObj[s] = 'sp_Account_Manager');
  const mockSectionAssignmentsJson = JSON.stringify(mockSectionAssignmentsObj);

  const mockSpecialistQuestionsArray = [
    { question: "What is your budget?", rationale: "To understand financial scope", category: "Financials" }
  ];
  const mockSpecialistQuestionsJson = JSON.stringify(mockSpecialistQuestionsArray);

  const mockOrganizedQuestionsObj = {
    organizedQuestions: [
      {
        theme: "Financials",
        questions: [
          { question: "What is your budget?", source: "sp_Account_Manager", id: "q1" }
        ]
      }
    ]
  };
  const mockOrganizedQuestionsJson = JSON.stringify(mockOrganizedQuestionsObj);
  
  const mockCustomerAnswers = "Our budget is $100,000 and the timeline is 3 months.";

  const mockReviewObj = { generalFeedback: "Looks good", suggestedRevisions: "None", questionsForCustomer: [], questionsForDraftingAgent: [] };
  const mockReviewJson = JSON.stringify(mockReviewObj);

  const originalGetReportMockSteps = [
    { phase: 'Setup', status: 'Completed', tokens: 0, details: 'Initial setup done' },
    { phase: 'Brief Analysis & Planning', status: 'Completed', tokens: 150, details: 'Analysis and planning complete' },
    { phase: 'Q&A and Development', status: 'Completed', tokens: 600, details: 'Development complete' },
    { phase: 'Review and Revision', status: 'Completed', tokens: 400, details: 'Revisions complete' },
    { phase: 'Final Assembly', status: 'Completed', tokens: 100, details: 'Assembly complete' }
  ];

  beforeEach(async () => {
    jest.clearAllMocks && jest.clearAllMocks();
    if (resetDatabase) {
      await resetDatabase();
    }

    responsesAgent.getTokenUsageReport = jest.fn(); // Initialize as a jest.fn()

    responsesAgent.createAndUploadFile.mockImplementation(async (content, fileName) => {
      const descriptivePartWithExt = fileName.substring(fileName.indexOf('_') + 1);
      const baseName = descriptivePartWithExt.substring(0, descriptivePartWithExt.lastIndexOf('.'));
      return `${baseName}-file-id`;
    });

    responsesAgent.createInitialResponse.mockImplementation(async (...args) => {
      console.log('[TEST DEBUG] createInitialResponse called with:', args);
      const [content, files, role] = args;
      let responseId = `msg-${role.toLowerCase().replace(/[^a-z0-9]/gi, '')}-${Date.now()}`;
      if (role === 'BriefAnalysis') return { response: mockBriefAnalysis, id: responseId, tokens: 50 };
      if (role === 'SectionAssignments' || role === 'sp_Collaboration_Orchestrator') return { response: mockSectionAssignmentsJson, id: responseId, tokens: 50 };
      if (role === 'OrganizeQuestions') return { response: mockOrganizedQuestionsJson, id: responseId, tokens: 50 };
      if (role === 'CustomerAnswers') return { response: mockCustomerAnswers, id: responseId, tokens: 50 };
      if (role === 'sp_Account_Manager' && content && content.includes("generate 3-5 important strategic clarifying questions")) {
        return { response: mockSpecialistQuestionsJson, id: responseId, tokens: 50 };
      }
      if (role && role.startsWith('sp_')) {
        if (content && content.includes("generate 3-5 important strategic clarifying questions")) {
          return { response: mockSpecialistQuestionsJson, id: responseId, tokens: 50 };
        } else if (content && content.includes("Draft the")) {
          const sectionMatch = content.match(/Draft the \"([^\"]+)\" section/);
          const section = sectionMatch ? sectionMatch[1] : "unknown_section";
          return { response: `Draft content for ${section}.`, id: responseId, tokens: 100 };
        }
      }
      if (role === 'QualityManager') {
        if (content && content.includes("Please review the attached section draft")) {
          return { response: mockReviewJson, id: responseId, tokens: 70 };
        } else if (content && content.includes("perform a final review")) {
          return { response: "Final approval granted.", id: responseId, tokens: 30 };
        }
      }
      console.warn(`[Test Mock] Unhandled createInitialResponse call for role: ${role}, content snippet: "${content ? content.substring(0, 100) : ''}"`);
      return { response: "Default mock createInitialResponse", id: responseId, tokens: 10 };
    });

    responsesAgent.forkResponse.mockImplementation(async (previousResponseId, content, files, role) => {
      let responseId = `msg-fork-${role.toLowerCase().replace(/[^a-z0-9]/gi, '')}-${Date.now()}`;
      if (role.startsWith('sp_') && content.includes("Please revise the")) {
        const sectionMatch = content.match(/revise the "([^"]+)" section/);
        const sectionName = sectionMatch ? sectionMatch[1] : "unknown_section"; 
        return { response: `Revised content for ${sectionName} after QM feedback.`, id: responseId, tokens: 80 };
      }
      console.warn(`[Test Mock] Unhandled forkResponse call for role: ${role}`);
      return { response: "Default mock forkResponse", id: responseId, tokens: 10 };
    });
  });

  afterAll(async () => {
    if (global.db && global.db.destroy) {
      await global.db.destroy();
    }
  });

  afterAll(async () => {
    // Attempt to close Knex DB connection if available
    try {
      const db = require('../db/index');
      if (db && db.destroy) {
        await db.destroy();
      }
    } catch (e) {
      // ignore
    }
  });

  test('full successful flow using Responses API', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // Force a non-test environment to bypass mock flow path

    const mockProposalIdForReport = "proposal-test123"; // A placeholder for setting up the mock

    const reportFilesTemplate = [];
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_brief.json` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_analysis.md` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_assignments.json` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_questions.json` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_customer_answers_initial.md` });
    sections.forEach(section => {
      const s_ = section.replace(/\s+/g, '_');
      reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_${s_}_draft.md` });
      reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_${s_}_review.json` });
      reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_${s_}_revised.md` });
    });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_final_review_manifest.txt` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_final_approval.txt` });
    reportFilesTemplate.push({ filePath: `/uploads/${mockProposalIdForReport}/${mockProposalIdForReport}_final_proposal.md` });

    // Setup the mock for getTokenUsageReport BEFORE the API call
    const expectedComponentDetails = [
      { phase: 'Phase1_BriefAnalysis', status: 'completed', tokens: 50, details: 'Brief analysis completed' },
      { phase: 'Phase1_SectionAssignments', status: 'completed', tokens: 50, details: 'Section assignments completed' },
      { phase: 'Phase1_ClarifyingQuestions', status: 'completed', tokens: 50, details: 'Clarifying questions completed' },
      { phase: 'Phase1_OrganizeQuestions', status: 'completed', tokens: 50, details: 'Questions organized' },
      { phase: 'Phase2_CustomerAnswers', status: 'completed', tokens: 50, details: 'Customer answers collected' },
      { phase: 'Phase2_SectionDrafts', status: 'completed', tokens: 400, details: 'Section drafts completed' },
      { phase: 'Phase3_Reviews', status: 'completed', tokens: 200, details: 'Section reviews completed' },
      { phase: 'Phase3_CustomerReviewAnswers', status: 'skipped', tokens: 0, details: 'No customer review questions' },
      { phase: 'Phase3_Revisions', status: 'completed', tokens: 200, details: 'Section revisions completed' },
      { phase: 'Phase4_FinalApproval', status: 'completed', tokens: 100, details: 'Final approval granted' },
      { phase: 'Phase4_Assembly', status: 'completed', tokens: 100, details: 'Final proposal assembled' }
    ];
    responsesAgent.getTokenUsageReport.mockReturnValue({
      overallTokens: { total: 1250 },
      componentDetails: expectedComponentDetails,
      files: reportFilesTemplate
    });

    try {
      // Start the flow and expect 202 with jobId
      const res = await request(app)
        .post('/agents/flow')
        .send({ brief: customerBrief, customerAnswers: mockCustomerAnswers });

      expect(res.statusCode).toBe(202);
      expect(res.body).toHaveProperty('jobId');
      expect(res.body).toHaveProperty('statusEndpoint');
      expect(res.body).toHaveProperty('resultEndpoint');
      const { jobId, statusEndpoint, resultEndpoint } = res.body;
      expect(typeof jobId).toBe('string');

      // Poll the status endpoint until completed (simulate immediate completion for test)
      // In real async, you'd poll with a delay; here, we assume the job is done after a short wait
      let statusRes, resultRes;
      let maxTries = 10;
      for (let i = 0; i < maxTries; i++) {
        statusRes = await request(app).get(statusEndpoint);
        if (statusRes.body.status === 'completed') break;
        // Optionally, wait a bit: await new Promise(r => setTimeout(r, 100));
      }
      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body).toHaveProperty('jobId', jobId);

      // Fetch the result
      resultRes = await request(app).get(resultEndpoint);
      expect(resultRes.statusCode).toBe(200);
      expect(resultRes.body).toHaveProperty('flowData');
      expect(resultRes.body).toHaveProperty('summary');
      const { flowData, summary } = resultRes.body;
      const actualProposalId = flowData.proposalId;

      const reportFiles = [];
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_brief.json` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_analysis.md` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_assignments.json` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_questions.json` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_customer_answers_initial.md` });

      sections.forEach(section => {
        const s_ = section.replace(/\s+/g, '_');
        reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_${s_}_draft.md` });
        reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_${s_}_review.json` });
        reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_${s_}_revised.md` });
      });

      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_final_review_manifest.txt` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_final_approval.txt` });
      reportFiles.push({ filePath: `/uploads/${actualProposalId}/${actualProposalId}_final_proposal.md` });

      responsesAgent.getTokenUsageReport.mockReturnValue({
        overallTokens: { total: 1250 },
        componentDetails: expectedComponentDetails,
        files: reportFiles
      });

      // --- Proposal ID ---
      expect(actualProposalId).toEqual(expect.stringMatching(/^proposal-\d+$/));
      expect(responsesAgent.resetProgress).toHaveBeenCalledTimes(1);

      // --- Phase 1: Brief Analysis & Planning ---
      // Brief Upload
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(JSON.stringify(customerBrief, null, 2), `${actualProposalId}_brief.json`);
      expect(flowData.briefFileId).toBe('brief-file-id');
      
      // Brief Analysis
      expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
        expect.any(String), [flowData.briefFileId], "BriefAnalysis", expect.anything(), expect.anything()
      );
      expect(flowData.briefAnalysis).toBe(mockBriefAnalysis);
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(mockBriefAnalysis, `${actualProposalId}_analysis.md`);
      expect(flowData.analysisFileId).toBe('analysis-file-id');
      
      // Section Assignments
      expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
        expect.any(String), [flowData.briefFileId, flowData.analysisFileId], "sp_Collaboration_Orchestrator", expect.anything(), expect.anything()
      );
      expect(flowData.sectionAssignments).toEqual(mockSectionAssignmentsObj);
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(JSON.stringify(mockSectionAssignmentsObj, null, 2), `${actualProposalId}_assignments.json`);
      expect(flowData.assignmentsFileId).toBe('assignments-file-id');

      // Clarifying Questions
      expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
        expect.stringContaining("generate 3-5 important strategic clarifying questions"), expect.anything(), "sp_Account_Manager", expect.anything(), expect.anything()
      );
      // Check that the files array contains both IDs
      const clarifyingCall = responsesAgent.createInitialResponse.mock.calls.find(call => call[2] === "sp_Account_Manager");
      expect(clarifyingCall[1]).toEqual(expect.arrayContaining([flowData.briefFileId, flowData.analysisFileId]));
      expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
        expect.stringContaining("organize them into logical groups"), expect.anything(), "OrganizeQuestions", expect.anything(), expect.anything()
      );
      expect(flowData.clarifyingQuestions).toEqual(mockOrganizedQuestionsObj);
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(JSON.stringify(mockOrganizedQuestionsObj, null, 2), `${actualProposalId}_questions.json`);
      expect(flowData.questionsFileId).toBe('questions-file-id');

      // --- Phase 2: Q&A and Development ---
      // Customer Answers
      expect(flowData.customerAnswers).toBe(mockCustomerAnswers);
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(mockCustomerAnswers, `${actualProposalId}_customer_answers_initial.md`);
      expect(flowData.customerAnswersFileId).toBe('customer_answers_initial-file-id');

      // Section Development
      expect(flowData.sectionDrafts).toBeDefined();
      for (const section of sections) {
        const assigneeRole = mockSectionAssignmentsObj[section];
        expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
          expect.stringContaining(`Draft the "${section}" section`),
          [flowData.briefFileId, flowData.analysisFileId, flowData.questionsFileId, flowData.customerAnswersFileId],
          assigneeRole,
          expect.anything(),
          expect.anything()
        );
        expect(flowData.sectionDrafts[section].content).toBe(`Draft content for ${section}.`);
        expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(`Draft content for ${section}.`, `${actualProposalId}_${section.replace(/\s+/g, '_')}_draft.md`);
        expect(flowData.sectionDrafts[section].fileId).toBe(`${section.replace(/\s+/g, '_')}_draft-file-id`);
      }

      // --- Phase 3: Review and Revision ---
      // QM Reviews
      expect(flowData.sectionReviews).toBeDefined();
      for (const section of sections) {
        const draftFileId = flowData.sectionDrafts[section].fileId;
        expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
          expect.stringContaining(`review the attached section draft (\"${section}\")`),
          [flowData.briefFileId, flowData.analysisFileId, flowData.questionsFileId, flowData.customerAnswersFileId, draftFileId],
          "QualityManager",
          expect.anything(),
          expect.anything()
        );
        expect(flowData.sectionReviews[section].reviewContent).toEqual(mockReviewObj);
        expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(JSON.stringify(mockReviewObj, null, 2), `${actualProposalId}_${section.replace(/\s+/g, '_')}_review.json`);
        expect(flowData.sectionReviews[section].fileId).toBe(`${section.replace(/\s+/g, '_')}_review-file-id`);
      }
      
      expect(flowData.customerReviewAnswersFileId).toBeNull();

      // Section Revisions
      expect(flowData.revisedSections).toBeDefined();
      for (const section of sections) {
        const assigneeRole = mockSectionAssignmentsObj[section];
        const draftFileId = flowData.sectionDrafts[section].fileId;
        const reviewFileId = flowData.sectionReviews[section].fileId;
        const expectedAttachmentsForRevision = [
          flowData.briefFileId,
          flowData.analysisFileId,
          flowData.questionsFileId,
          flowData.customerAnswersFileId,
          draftFileId,
          reviewFileId
        ];

        expect(responsesAgent.forkResponse).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining(`Please revise the "${section}" section`),
          expectedAttachmentsForRevision,
          assigneeRole
        );
        expect(flowData.revisedSections[section].content).toBe(`Revised content for ${section} after QM feedback.`);
        expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(`Revised content for ${section} after QM feedback.`, `${actualProposalId}_${section.replace(/\s+/g, '_')}_revised.md`);
        expect(flowData.revisedSections[section].fileId).toBe(`${section.replace(/\s+/g, '_')}_revised-file-id`);
      }

      // --- Phase 4: Final Assembly ---
      const expectedFilesForFinalReview = [
        flowData.briefFileId,
        flowData.analysisFileId,
        flowData.questionsFileId,
        flowData.customerAnswersFileId,
        `${actualProposalId}_final_review_manifest-file-id`.replace(`${actualProposalId}_`, ''),
        ...sections.map(s => flowData.revisedSections[s].fileId)
      ];
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(expect.stringContaining("Section:"), `${actualProposalId}_final_review_manifest.txt`);

      expect(responsesAgent.createInitialResponse).toHaveBeenCalledWith(
        expect.stringContaining("perform a final review of all attached revised sections"),
        expectedFilesForFinalReview,
        "QualityManager",
        expect.anything(),
        expect.anything()
      );
      expect(flowData.finalApprovalContent).toBe("Final approval granted.");
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith("Final approval granted.", `${actualProposalId}_final_approval.txt`);
      expect(flowData.finalApprovalFileId).toBe('final_approval-file-id');

      const expectedAssembledContent = sections.map(sec => `Revised content for ${sec} after QM feedback.`).join('\n\n---\n\n');
      expect(flowData.assembledProposalContent).toBe(expectedAssembledContent);
      expect(responsesAgent.createAndUploadFile).toHaveBeenCalledWith(expectedAssembledContent, `${actualProposalId}_final_proposal.md`);
      expect(flowData.finalProposalFileId).toBe('final_proposal-file-id');

      expect(summary.status).toBe('completed');
      expect(summary.message).toBe('Flow completed successfully.');
      expect(summary.totalTokensUsed).toBe(1250);
      expect(summary.progressUpdates).toEqual(expectedComponentDetails);
      
      expect(Array.isArray(summary.filesGenerated)).toBe(true);
      const expectedFilePaths = [];
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_brief.json`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_analysis.md`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_assignments.json`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_questions.json`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_customer_answers_initial.md`);
      sections.forEach(section => {
        const s_ = section.replace(/\s+/g, '_');
        expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_${s_}_draft.md`);
        expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_${s_}_review.json`);
        expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_${s_}_revised.md`);
      });
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_final_review_manifest.txt`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_final_approval.txt`);
      expectedFilePaths.push(`/uploads/${actualProposalId}/${actualProposalId}_final_proposal.md`);
      
      expect(summary.filesGenerated.sort()).toEqual(expectedFilePaths.sort());

      expect(responsesAgent.trackTokenUsage).toHaveBeenCalled();
      expect(responsesAgent.updateProgressStatus).toHaveBeenCalled();
      expect(responsesAgent.updateProgressStatus).toHaveBeenCalledWith(actualProposalId, "Phase1_BriefAnalysis", "completed", expect.any(Object));
    } finally {
      process.env.NODE_ENV = originalNodeEnv; // Restore original NODE_ENV
    }
  });

  test('returns 400 when missing brief', async () => {
    const res = await request(app)
      .post('/agents/flow')
      .send({ customerAnswers: "Some answers" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toBe('`brief` object is required'); 
  });
});
