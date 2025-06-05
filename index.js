const express = require('express');
const Joi = require('joi');
require('dotenv').config();
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
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
      }
    }
  },
  apis: ['./index.js', './routes/flowAgentOrchestrator.js']
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Only keep root, health, and error handler
app.get('/', (req, res) => {
  res.send('Hello, world!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

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

if (require.main === module) {
  app.listen(port, '0.0.0.0', async () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Monitoring dashboard available at http://localhost:${port}/monitor/`);
  });
}

module.exports = app;

// Register monitor routes - should be available regardless of how app is started
app.use('/api/monitor', monitorRoutes);

// Register the new /api/flow/runFullFlow endpoint
const flowAgentOrchestratorRouter = require('./routes/flowAgentOrchestrator');
app.use('/api/flow', flowAgentOrchestratorRouter);

// Register legacy/deprecated endpoints via new routers
const agentsProposalsRouter = require('./routes/agentsProposals');
app.use('/agents/proposals', agentsProposalsRouter);

const agentsOrchestrateRouter = require('./routes/agentsOrchestrate');
app.use('/agents/orchestrate', agentsOrchestrateRouter);

const agentsAssistantsRouter = require('./routes/agentsAssistants');
app.use('/agents/assistants', agentsAssistantsRouter);

const agentsFlowRouter = require('./routes/agentsFlow');
app.use('/agents/flow', agentsFlowRouter);

// Expose OpenAPI JSON for testing and contract validation
app.get('/openapi.json', (req, res) => {
  res.json(swaggerDocs);
});
