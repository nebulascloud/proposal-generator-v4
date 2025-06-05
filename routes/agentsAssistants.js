const express = require('express');
const { createAssistant, getAssistantResponse } = require('../agents/assistantAgent');
const { assistantDefinitions } = require('../agents/assistantDefinitions');

const router = express.Router();

/**
 * @swagger
 * /agents/assistants:
 *   post:
 *     summary: Create assistants based on definitions or a single assistant
 *     deprecated: true
 *     description: DEPRECATED: This endpoint is no longer recommended. Use /api/flow/runFullFlow for assistant management. Will be removed in a future release.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *               instructions:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Assistant(s) created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: string
 */
router.post('/', async (req, res) => {
  const { role, instructions } = req.body || {};
  if (role || instructions) {
    if (!role || typeof role !== 'string' || !instructions || typeof instructions !== 'string') {
      return res.status(400).json({ error: 'role and instructions are required strings' });
    }
    try {
      const assistantId = await createAssistant(role, instructions);
      return res.status(201).json({ assistantId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  try {
    const results = {};
    if (assistantDefinitions && typeof assistantDefinitions === 'object') {
      for (const [key] of Object.entries(assistantDefinitions)) {
        const id = await createAssistant(key);
        results[key] = id;
      }
    } else {
      console.error('assistantDefinitions is not properly defined:', assistantDefinitions);
    }
    return res.status(200).json(results);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /agents/assistants/{assistantId}/messages:
 *   post:
 *     summary: Send a message to an assistant thread
 *     deprecated: true
 *     description: DEPRECATED: This endpoint is no longer recommended. Use /api/flow/runFullFlow for assistant messaging. Will be removed in a future release.
 *     parameters:
 *       - in: path
 *         name: assistantId
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Assistant reply
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 */
router.post('/:assistantId/messages', async (req, res) => {
  const { assistantId } = req.params;
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required string' });
  }
  try {
    const reply = await getAssistantResponse(assistantId, message);
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
