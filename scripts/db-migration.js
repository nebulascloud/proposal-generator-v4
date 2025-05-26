/**
 * Database Migration Script
 * Runs migrations for the database based on the environment
 */

require('dotenv').config();
const path = require('path');
const knex = require('knex');
const knexConfig = require('../db/knexfile');

// Determine environment
const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

console.log(`Running migrations for ${environment} environment...`);

const db = knex(config);

// Run migrations
db.migrate.latest()
  .then(() => {
    console.log('Migrations completed successfully');
    return db.seed.run();
  })
  .then(() => {
    console.log('Seeds completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error running migrations:', err);
    process.exit(1);
  })
  .finally(() => {
    db.destroy();
  });
