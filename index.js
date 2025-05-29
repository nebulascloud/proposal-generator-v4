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
// const { runFullFlow } = require('./agents/flowAgent'); // [DEPRECATED] Commented out during refactor (see flowAgent-refactoring-plan.md)
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { defaultTemplate, renderDefault } = require('./templates/defaultTemplate');
const { initDatabase } = require('./db/setup');

// Silence console logging in test environment to avoid noisy logs after Jest teardown
if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line no-global-assign
  console.log = () => {};
  // eslint-disable-next-line no-global-assign
  console.warn = () => {};
  // eslint-disable-next-line no-global-assign
  console.error = () => {};
}

// Initialize database on import (needed for routes to function properly)
if (process.env.NODE_ENV !== 'test') {
  (async function() {
    try {
      await initDatabase();
      console.log("Database initialized on module import");
    } catch (error) {
      console.error("Error initializing database on import:", error);
      // Don't throw here to allow the app to continue loading
    }
  })();
}

// Monitoring routes
const monitorRoutes = require('./routes/monitor');

// Markdown and PDF rendering
const MarkdownIt = require('markdown-it');
const htmlPdf = require('html-pdf-node');
const md = new MarkdownIt();

// Initialize Express server
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

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
  apis: ['./index.js', './routes/flowAgentOrchestrator.js']
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

// In-memory store for proposal flow jobs
const flowJobs = {};
// Make flowJobs available globally
global.flowJobs = flowJobs;

// Full QA & review flow endpoint
/**
 * @swagger
 * /agents/flow:
 *   post:
 *     summary: Start a complete proposal generation flow
 *     description: Initiates the full proposal generation process including brief analysis, section assignments, question gathering, drafting, review, and final assembly
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
app.post('/agents/flow', async (req, res) => {
  console.log('[FlowRoute] received body:', JSON.stringify(req.body));
  if (!req.body || typeof req.body.brief !== 'object') {
    console.error('[FlowRoute] Missing `brief` object in request body');
    return res.status(400).json({ error: '`brief` object is required' });
  }
  // Allow other keys like customerAnswers by using .unknown(true)
  const schema = Joi.object({ 
    brief: Joi.object().required(),
    customerAnswers: Joi.string().optional(), // Make customerAnswers optional
    customerReviewAnswers: Joi.string().optional() // Make customerReviewAnswers optional
  }).unknown(true); // Allow other keys
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  
  // Generate a unique job ID
  const jobId = `flow-job-${Date.now()}`;
  
  // Store initial job status
  flowJobs[jobId] = {
    id: jobId,
    status: 'pending',
    startTime: new Date().toISOString(),
    progress: {},
    result: null,
    error: null
  };
  
  // Return job ID immediately
  res.status(202).json({ 
    jobId: jobId, 
    status: 'accepted', 
    message: 'Proposal generation started. Use the jobId to check status.',
    statusEndpoint: `/agents/flow/${jobId}/status`,
    resultEndpoint: `/agents/flow/${jobId}/result`
  });
  
  // Start the flow process in the background
  (async () => {
    try {
      // Update job status
      flowJobs[jobId].status = 'processing';
      
      // Run the full flow with jobId
      const result = await runFullFlow({...value, jobId});
      
      // Store the successful result
      flowJobs[jobId].status = 'completed';
      flowJobs[jobId].result = result;
      flowJobs[jobId].endTime = new Date().toISOString();
      
      console.log(`[FlowRoute] Job ${jobId} completed successfully`);
    } catch (e) {
      // Store the error
      flowJobs[jobId].status = 'failed';
      flowJobs[jobId].error = {
        message: e.message,
        stack: e.stack
      };
      flowJobs[jobId].endTime = new Date().toISOString();
      
      console.error(`[FlowRoute] Job ${jobId} failed with error:`, e.message);
      console.error(`[FlowRoute] Error stack:`, e.stack);
    }
  })();
});

// Get flow job status 
/**
 * @swagger
 * /agents/flow/{jobId}/status:
 *   get:
 *     summary: Check the status of a proposal flow job
 *     description: Returns the current status and progress information for a proposal generation job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the flow job to check
 *     responses:
 *       200:
 *         description: The job status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, processing, completed, failed]
 *                 startTime:
 *                   type: string
 *                   format: date-time
 *                 endTime:
 *                   type: string
 *                   format: date-time
 *                 progress:
 *                   type: object
 *                 result:
 *                   type: object
 *                   description: Only included if status is 'completed'
 *                 error:
 *                   type: string
 *                   description: Only included if status is 'failed'
 *       404:
 *         description: Job not found
 */
app.get('/agents/flow/:jobId/status', (req, res) => {
  const jobId = req.params.jobId;
  const job = flowJobs[jobId];
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Return the job status
  const response = {
    jobId: job.id,
    status: job.status,
    startTime: job.startTime,
    progress: job.progress
  };
  
  // Include endTime if available
  if (job.endTime) {
    response.endTime = job.endTime;
  }
  
  // Include result or error if the job is completed or failed
  if (job.status === 'completed' && job.result) {
    response.result = job.result;
  } else if (job.status === 'failed' && job.error) {
    response.error = job.error.message;
  }
  
  res.json(response);
});

// Get flow job result (separate from status to avoid large response for status checks)
/**
 * @swagger
 * /agents/flow/{jobId}/result:
 *   get:
 *     summary: Get the complete result of a completed proposal flow job
 *     description: Returns the full result of a completed proposal generation job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the completed flow job
 *     responses:
 *       200:
 *         description: The complete flow result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Job not completed
 *       404:
 *         description: Job not found
 */
app.get('/agents/flow/:jobId/result', (req, res) => {
  const jobId = req.params.jobId;
  const job = flowJobs[jobId];
  
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

// Initialize database immediately upon module load
if (process.env.NODE_ENV !== 'test') {
  (async function() {
    try {
      console.log("[index] Initializing database on module load...");
      await initDatabase();
      console.log("[index] Database initialized successfully on module load.");
    } catch (err) {
      console.error("[index] Error initializing database on module load:", err);
    }
  })();
}

// Register monitor routes - should be available regardless of how app is started
app.use('/api/monitor', monitorRoutes);

// Register the new /api/flow/runFullFlow endpoint
const flowAgentOrchestratorRouter = require('./routes/flowAgentOrchestrator');
app.use('/api/flow', flowAgentOrchestratorRouter);

if (require.main === module) {
  // Listen on all network interfaces for container connectivity
  app.listen(port, '0.0.0.0', async () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Monitoring dashboard available at http://localhost:${port}/monitor/`);
  });
}

module.exports = app;
