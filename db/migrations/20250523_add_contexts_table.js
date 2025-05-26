/**
 * Add Contexts Table Migration
 * Creates a dedicated table for storing JSON context data
 */

exports.up = function(knex) {
  return knex.schema.createTable('contexts', table => {
    table.uuid('id').primary();
    table.text('data').notNullable();  // JSON data stored as text
    table.json('metadata');            // Additional metadata for the context
    table.timestamps(true, true);      // Created and updated timestamps
    
    // Add indexes for faster querying
    table.index(['created_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('contexts');
};
