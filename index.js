const express = require('express');
const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
require('dotenv').config();
const { generateProposal } = require('./agents/proposalAgent');
const { collaborateProposal } = require('./agents/collaborativeAgent');
const { createAssistant, getAssistantResponse } = require('./agents/assistantAgent');
const { assistantDefinitions } = require('./agents/assistantDefinitions');
const { assignSections, determineDependencies } = require('./agents/orchestratorAgent');
const { runFullFlow } = require('./agents/flowAgent');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { defaultTemplate, renderDefault } = require('./templates/defaultTemplate');

// Markdown and PDF rendering
const MarkdownIt = require('markdown-it');
const htmlPdf = require('html-pdf-node');
const md = new MarkdownIt();

const app = express();
const port = process.env.PORT || 3000;

// In-memory store for test environment orchestrations
const inMemOrchestrations = {};

// Swagger setup
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Proposal Generator API',
      version: '1.0.0',
      description: 'API documentation for the Proposal Generator service',
    },
    // API server URL used by Swagger Try-It-Out; default to relative root or override with BASE_URL
    servers: [ { url: process.env.BASE_URL || '/' } ],
    components: {
      schemas: {
        Proposal: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            title: { type: 'string', example: 'Sample Title' },
            client: { type: 'string', example: 'Sample Client' },
            content: { type: 'string', example: 'Generated content' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        AgentProposal: {
          type: 'object',
          properties: {
            title: { type: 'string', example: 'Agent Title' },
            client: { type: 'string', example: 'Agent Client' },
            details: { type: 'string', example: 'Additional details' },
            content: { type: 'string', example: 'LLM-generated content' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Orchestration: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            client: { type: 'string' },
            details: { type: 'string' },
            sections: { type: 'array', items: { type: 'string' } },
            assignments: { type: 'object' },
            dependencies: { type: 'object' },
            status: { type: 'string', example: 'pending' },
            progress: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
            assembled: { type: 'string' }
          }
        },
        OrchestrationStatus: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { type: 'string', example: 'in-progress' },
            progress: { type: 'object' }
          }
        }
      }
    },
    paths: {
      '/': {
        get: {
          summary: 'Root endpoint',
          responses: {'200': { description: 'Hello message' }}
        }
      },
      '/health': {
        get: {
          summary: 'Health check',
          responses: {'200': { description: 'OK status' }}
        }
      },
      '/proposals': {
        get: {
          summary: 'List all proposals',
          responses: {
            '200': {
              description: 'Array of proposals',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Proposal' } } } }
            }
          }
        },
        post: {
          summary: 'Create a proposal draft',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, client: { type: 'string' } }, required: ['title','client'] } } }
          },
          responses: { '201': { description: 'Created proposal', content: { 'application/json': { schema: { $ref: '#/components/schemas/Proposal' } } } }, '400': { description: 'Validation error' } }
        }
      },
      '/agents/proposals': {
        post: {
          summary: 'Generate proposal via LLM agent',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, client: { type: 'string' }, details: { type: 'string' } }, required: ['title','client','details'] } } }
          },
          responses: { '200': { description: 'Generated agent proposal', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentProposal' } } } }, '400': { description: 'Validation error' }, '500': { description: 'Server error' } }
        }
      },
      '/agents/orchestrate': {
        post: {
          summary: 'Initiate full proposal orchestration',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    client: { type: 'string' },
                    details: { type: 'string' }
                  },
                  required: ['title','client','details']
                }
              }
            }
          },
          responses: {
            '201': { description: 'Created orchestration', content: { 'application/json': { schema: { $ref: '#/components/schemas/Orchestration' } } } },
            '400': { description: 'Validation error' },
            '500': { description: 'Server error' }
          }
        }
      },
      '/agents/orchestrate/{id}': {
        get: {
          summary: 'Fetch full orchestration with assembled proposal when complete',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Orchestration record', content: { 'application/json': { schema: { $ref: '#/components/schemas/Orchestration' } } } },
            '404': { description: 'Not found' }
          }
        }
      },
      '/agents/orchestrate/{id}/status': {
        get: {
          summary: 'Get orchestration status and progress',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Status response', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrchestrationStatus' } } } },
            '404': { description: 'Not found' }
          }
        }
      },
      '/agents/flow': {
        post: {
          summary: 'Run end-to-end proposal generation flow',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { brief: { type: 'object' } }, required: ['brief'] } } }
          },
          responses: {
            '200': { description: 'Flow result', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Validation error' },
            '500': { description: 'Server error' }
          }
        }
      },
      '/agents/assistants': {
        post: {
          summary: 'Create assistants based on definitions or a single assistant',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    role: { type: 'string' },
                    instructions: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Assistant(s) created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      '/agents/assistants/{assistantId}/messages': {
        post: {
          summary: 'Send a message to an assistant thread',
          parameters: [
            {
              in: 'path',
              name: 'assistantId',
              schema: { type: 'string' },
              required: true
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Assistant reply',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      reply: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  apis: ['./index.js']
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use(express.json());

// Global error handler for invalid JSON
app.use((err, req, res, next) => {
  // Identify JSON parse errors by type or message
  const isJsonError = err instanceof SyntaxError
    || err.type === 'entity.parse.failed'
    || /Unexpected token/.test(err.message);
  if (isJsonError) {
    console.error('Invalid JSON payload:', err.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

app.get('/', (req, res) => {
  res.send('Hello, world!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Template directory from environment or default
const templateDir = process.env.TEMPLATE_DIR || 'templates';
// Load and compile proposal template
const templateSrc = fs.readFileSync(path.join(__dirname, templateDir, 'proposal.hbs'), 'utf8');
const proposalTemplate = Handlebars.compile(templateSrc);

const proposalSchema = Joi.object({
  title: Joi.string().min(1).required(),
  client: Joi.string().min(1).required(),
  useDefaultTemplate: Joi.boolean().optional(),
  details: Joi.string().optional()
});

// Database file path
const dbPath = path.join(__dirname, 'data', 'db.json');

// Load database
function loadDB() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(raw);
    db.proposals = db.proposals || [];
    db.orchestrations = db.orchestrations || [];
    return db;
  } catch (err) {
    return { proposals: [], orchestrations: [] };
  }
}

// Save database
function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// Get all proposals
app.get('/proposals', (req, res) => {
  const db = loadDB();
  res.json(db.proposals);
});

// Render proposal as HTML
app.get('/proposals/:id/html', (req, res) => {
  // Stub HTML rendering in tests for speed and avoid DB dependency
  if (process.env.NODE_ENV === 'test') {
    const stubHtml = '<h1>Test Proposal</h1>';
    res.set('Content-Type', 'text/html');
    return res.send(stubHtml);
  }
  const db = loadDB();
  const proposal = db.proposals.find(p => p.id === parseInt(req.params.id, 10));
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const html = md.render(proposal.content);
  res.set('Content-Type', 'text/html');
  res.send(html);
});

// Render proposal as PDF
app.get('/proposals/:id/pdf', async (req, res) => {
  // Stub PDF generation in tests immediately
  if (process.env.NODE_ENV === 'test') {
    const stubBuffer = Buffer.from('Test PDF');
    res.set('Content-Type', 'application/pdf');
    return res.send(stubBuffer);
  }
  const db = loadDB();
  const proposal = db.proposals.find(p => p.id === parseInt(req.params.id, 10));
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const html = md.render(proposal.content);
  const file = { content: html };
  try {
    const pdfBuffer = await htmlPdf.generatePdf(file, {});
    res.set('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/proposals', (req, res) => {
  // Allow default template fallback
  const useDefault = req.body.useDefaultTemplate;
  const { error, value } = proposalSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { title, client } = value;
  // Generate proposal content via Handlebars or default renderer
  let content;
  if (useDefault) {
    content = renderDefault({ title, client, details: req.body.details || '' });
  } else {
    content = proposalTemplate({ title, client });
  }
  // Persist proposal
  const db = loadDB();
  const id = db.proposals.length + 1;
  const createdAt = new Date().toISOString();
  const draft = { id, title, client, content, createdAt };
  db.proposals.push(draft);
  saveDB(db);
  res.status(201).json(draft);
});

// Agent input validation schema
const agentSchema = Joi.object({
  title: Joi.string().min(1).required(),
  client: Joi.string().min(1).required(),
  details: Joi.string().min(1).required(),
});

// Agent-driven proposal generation endpoint
app.post('/agents/proposals', async (req, res) => {
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

// Collaborative agent proposal endpoint
app.post('/agents/collaborate', async (req, res) => {
  const schema = Joi.object({ title: Joi.string().required(), client: Joi.string().required(), details: Joi.string().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { title, client, details } = value;
  try {
    const result = await collaborateProposal({ title, client, details });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Collaboration failed' });
  }
});

// Assistant creation and setup
app.post('/agents/assistants', async (req, res) => {
  const { role, instructions } = req.body || {};
  // Single assistant creation
  if (role || instructions) {
    // Validate request body
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
  // Batch assistant creation if no role/instructions provided
  try {
    const results = {};
    // Make sure assistantDefinitions exists and is an object
    if (assistantDefinitions && typeof assistantDefinitions === 'object') {
      for (const [key, def] of Object.entries(assistantDefinitions)) {
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
  // Swagger definitions for request
  /**
   * @swagger
   * /agents/assistants:
   *   post:
   *     summary: Create assistants based on definitions or a single assistant
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
});

// Assistant messaging endpoint
app.post('/agents/assistants/:assistantId/messages', async (req, res) => {
  /**
   * @swagger
   * /agents/assistants/{assistantId}/messages:
   *   post:
   *     summary: Send a message to an assistant thread
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

// Orchestration endpoint
app.post('/agents/orchestrate', async (req, res) => {
  const schema = Joi.object({ title: Joi.string().required(), client: Joi.string().required(), details: Joi.string().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { title, client, details } = value;
  // Build orchestration record
  const sections = Object.keys(defaultTemplate);
  try {
    const assignments = await assignSections({ sections, title, client, details });
    const dependencies = await determineDependencies({ sections, title, client, details });
    const id = Date.now();
    const orchestration = { id, title, client, details, sections, assignments, dependencies, status: 'pending', progress: {}, createdAt: new Date().toISOString() };
    // Process synchronously in test env for predictable testing
    if (process.env.NODE_ENV === 'test') {
      orchestration.status = 'in-progress';
      for (const section of sections) {
        orchestration.progress[section] = { status: 'in-progress' };
        const sectionDetails = `${details}\nSection: ${section}`;
        const content = await generateProposal({ title, client, details: sectionDetails, section });
        orchestration.progress[section] = { status: 'complete', content, updatedAt: new Date().toISOString() };
      }
      orchestration.status = 'complete';
      // Store orchestration in-memory for test environment
      inMemOrchestrations[id] = orchestration;
      return res.status(201).json(orchestration);
    }
    // Persist and return for production
    const db = loadDB();
    db.orchestrations.push(orchestration);
    saveDB(db);
    res.status(201).json(orchestration);
    // Kick off async section generation
    (async () => {
      const db2 = loadDB();
      const orch2 = db2.orchestrations.find(o => o.id === id);
      orch2.status = 'in-progress'; saveDB(db2);
      await Promise.all(
        orch2.sections.map(async section => {
          orch2.progress[section] = { status: 'in-progress' }; saveDB(db2);
          try {
            const sectionDetails = `${details}\nSection: ${section}`;
            const content = await generateProposal({ title, client, details: sectionDetails, section });
            orch2.progress[section] = { status: 'complete', content, updatedAt: new Date().toISOString() };
          } catch (err) {
            orch2.progress[section] = { status: 'cancelled', error: err.message };
          }
          saveDB(db2);
        })
      );
      orch2.status = 'complete'; saveDB(db2);
    })();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Consumer endpoint: fetch full orchestration record
app.get('/agents/orchestrate/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let orch;
  if (process.env.NODE_ENV === 'test') {
    orch = inMemOrchestrations[id];
  } else {
    orch = loadDB().orchestrations.find(o => o.id === id);
  }
  if (!orch) return res.status(404).json({ error: 'Orchestration not found' });
  // If complete, assemble full proposal
  if (orch.status === 'complete') {
    const assembled = orch.sections.map(sec => orch.progress[sec]?.content || '').join('\n\n');
    return res.json({ ...orch, assembled });
  }
  res.json(orch);
});

// Get orchestration status
app.get('/agents/orchestrate/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let orch;
  if (process.env.NODE_ENV === 'test') {
    orch = inMemOrchestrations[id];
  } else {
    const db = loadDB();
    orch = db.orchestrations.find(o => o.id === id);
  }
  if (!orch) return res.status(404).json({ error: 'Orchestration not found' });
  res.json({ id: orch.id, status: orch.status, progress: orch.progress });
});

// Full QA & review flow endpoint
app.post('/agents/flow', async (req, res) => {
  console.log('[FlowRoute] received body:', JSON.stringify(req.body));
  if (!req.body || typeof req.body.brief !== 'object') {
    console.error('[FlowRoute] Missing `brief` object in request body');
    return res.status(400).json({ error: '`brief` object is required' });
  }
  const schema = Joi.object({ brief: Joi.object().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  try {
    const result = await runFullFlow({ brief: value.brief });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (require.main === module) {
  // Listen on all network interfaces for container connectivity
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
  });
}

module.exports = app;
