-- Purge (truncate) the agents table and reset its identity sequence
TRUNCATE TABLE agents RESTART IDENTITY;

-- Confirm the table is empty
SELECT * FROM agents;

-- This script will remove all rows from the agents table and reset the primary key sequence.
-- The SELECT statement will show the (empty) contents after truncation.
