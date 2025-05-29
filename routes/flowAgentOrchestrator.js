// routes/flowAgentOrchestrator.js

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { runFullFlow } = require('../agents/flowAgentOrchestrator');

// Global object to store orchestrator jobs
const orchestratorJobs = {};
global.orchestratorJobs = orchestratorJobs;

/**
 * @swagger
 * /api/flow/runFullFlow:
 *   post:
 *     tags:
 *       - Proposal Flow
 *     summary: Start the modular full proposal generation flow
 *     description: Initiates the new modular, phase-based proposal generation process. Only 'brief' is required in the request body. The server generates a jobId and returns endpoints for status/result.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - brief
 *             properties:
 *               brief:
 *                 type: object
 *                 description: The project brief containing the initial information
 *               customerAnswers:
 *                 type: string
 *                 description: Pre-supplied customer answers to clarifying questions
 *               customerReviewAnswers:
 *                 type: string
 *                 description: Pre-supplied customer answers to review questions
 *     responses:
 *       202:
 *         description: Flow job accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [accepted]
 *                 message:
 *                   type: string
 *                 statusEndpoint:
 *                   type: string
 *                 resultEndpoint:
 *                   type: string
 *       400:
 *         description: Invalid request
 */
router.post('/runFullFlow', async (req, res) => {
  // Only require 'brief' in the request body
  const schema = Joi.object({
    brief: Joi.object().required(),
    customerAnswers: Joi.string().optional(),
    customerReviewAnswers: Joi.string().optional()
  }).unknown(true);
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  // Generate a unique job ID (never expect it from the client)
  const jobId = `orchestrator-job-${Date.now()}`;

  orchestratorJobs[jobId] = {
    id: jobId,
    status: 'pending',
    startTime: new Date().toISOString(),
    progress: {},
    result: null,
    error: null
  };

  res.status(202).json({
    jobId: jobId,
    status: 'accepted',
    message: 'Proposal generation started. Use the jobId to check status.',
    statusEndpoint: `/api/flow/${jobId}/status`,
    resultEndpoint: `/api/flow/${jobId}/result`
  });

  (async () => {
    try {
      orchestratorJobs[jobId].status = 'processing';
      // Pass jobId to orchestrator
      const result = await runFullFlow({ ...value, jobId });
      orchestratorJobs[jobId].status = 'completed';
      orchestratorJobs[jobId].result = result;
      orchestratorJobs[jobId].endTime = new Date().toISOString();
    } catch (e) {
      orchestratorJobs[jobId].status = 'failed';
      orchestratorJobs[jobId].error = {
        message: e.message,
        stack: e.stack
      };
      orchestratorJobs[jobId].endTime = new Date().toISOString();
    }
  })();
});

// Status endpoint for orchestrator jobs
router.get('/:jobId/status', (req, res) => {
  const jobId = req.params.jobId;
  const job = orchestratorJobs[jobId];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const response = {
    jobId: job.id,
    status: job.status,
    startTime: job.startTime,
    progress: job.progress
  };
  if (job.endTime) {
    response.endTime = job.endTime;
  }
  if (job.status === 'completed' && job.result) {
    response.result = job.result;
  } else if (job.status === 'failed' && job.error) {
    response.error = job.error.message;
  }
  res.json(response);
});

// Result endpoint for orchestrator jobs
router.get('/:jobId/result', (req, res) => {
  const jobId = req.params.jobId;
  const job = orchestratorJobs[jobId];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'completed') {
    return res.status(400).json({
      error: 'Job not completed',
      status: job.status,
      message: 'The job is still processing or has failed. Check the status endpoint for details.'
    });
  }
  res.json(job.result);
});

module.exports = router;
