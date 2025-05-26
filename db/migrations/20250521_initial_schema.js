/**
 * Initial Database Schema Migration
 * Creates tables for messages, agents, and sessions
 */

exports.up = function(knex) {
  // Create sessions table first (it will be referenced by messages)
  return knex.schema.createTable('sessions', table => {
    table.uuid('id').primary();
    table.string('proposal_id').notNullable();
    table.string('customer_brief_id');
    table.string('status').defaultTo('active');
    table.json('metadata'); // Store additional info as JSON
    table.timestamps(true, true); // Created and updated timestamps
  })
  
  // Create agents table
  .then(() => {
    return knex.schema.createTable('agents', table => {
      table.increments('id').primary();
      table.string('name').notNullable().unique();
      table.text('instructions');
      table.timestamps(true, true);
    });
  })
  
  // Create messages table
  .then(() => {
    return knex.schema.createTable('messages', table => {
      table.uuid('id').primary();
      table.string('response_id').notNullable(); // OpenAI response ID
      table.string('phase'); // clarification, draft, review, etc.
      table.string('agent_name');
      table.string('role').notNullable(); // user, assistant
      table.text('content').notNullable();
      table.uuid('parent_message_id').references('id').inTable('messages').onDelete('SET NULL');
      table.uuid('session_id').notNullable().references('id').inTable('sessions').onDelete('CASCADE');
      table.json('metadata'); // For additional data (token usage, etc.)
      table.timestamps(true, true);
      
      // Add indexes for faster querying
      table.index(['session_id']);
      table.index(['response_id']);
      table.index(['phase']);
    });
  });
};

exports.down = function(knex) {
  // Drop tables in reverse order of creation
  return knex.schema
    .dropTableIfExists('messages')
    .dropTableIfExists('agents')
    .dropTableIfExists('sessions');
};
