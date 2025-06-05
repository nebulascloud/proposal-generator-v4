const express = require('express');
const Joi = require('joi');

const router = express.Router();

// In-memory store for proposal flow jobs
const flowJobs = {};
global.flowJobs = flowJobs;

/**
 * @swagger
 * /agents/flow:
 *   post:
 *     summary: Run end-to-end proposal generation flow
 *     deprecated: true
 *     description: DEPRECATED: Use /api/flow/runFullFlow instead. This endpoint is retained for backward compatibility and will be removed in a future release. Initiates the legacy proposal generation process.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               brief:
 *                 type: object
 *             required:
 *               - brief
 *     responses:
 *       200:
 *         description: Flow result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  // ...existing code for legacy flow endpoint...
  res.status(501).json({ error: 'Not implemented in refactor stub' });
});

// GET /agents/flow/:jobId/status
router.get('/:jobId/status', (req, res) => {
  // ...existing code for legacy flow status...
  res.status(501).json({ error: 'Not implemented in refactor stub' });
});

// GET /agents/flow/:jobId/result
router.get('/:jobId/result', (req, res) => {
  // ...existing code for legacy flow result...
  res.status(501).json({ error: 'Not implemented in refactor stub' });
});

module.exports = router;
