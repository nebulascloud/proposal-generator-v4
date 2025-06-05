const express = require('express');
const Joi = require('joi');
const { generateProposal } = require('../agents/proposalAgent');

const router = express.Router();

// Agent input validation schema
const agentSchema = Joi.object({
  title: Joi.string().min(1).required(),
  client: Joi.string().min(1).required(),
  details: Joi.string().min(1).required(),
});

/**
 * @swagger
 * /agents/proposals:
 *   post:
 *     summary: Generate proposal via LLM agent
 *     deprecated: true
 *     description: DEPRECATED: This endpoint is no longer recommended. Use /api/flow/runFullFlow for proposal generation. Will be removed in a future release.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               client:
 *                 type: string
 *               details:
 *                 type: string
 *             required:
 *               - title
 *               - client
 *               - details
 *     responses:
 *       200:
 *         description: Generated agent proposal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentProposal'
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const { error, value } = agentSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { title, client, details } = value;
  try {
    const content = await generateProposal({ title, client, details });
    const createdAt = new Date().toISOString();
    res.json({ title, client, details, content, createdAt });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate proposal' });
  }
});

module.exports = router;
