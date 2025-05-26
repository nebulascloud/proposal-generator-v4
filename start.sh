#!/bin/sh
# start.sh - Script to wait for PostgreSQL and start the application

echo "Waiting for PostgreSQL to be ready..."
MAX_ATTEMPTS=30
COUNTER=0

while [ $COUNTER -lt $MAX_ATTEMPTS ]; do
  COUNTER=$((COUNTER+1))
  echo "Attempt $COUNTER/$MAX_ATTEMPTS..."
  
  # Try to connect to PostgreSQL
  pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER
  
  if [ $? -eq 0 ]; then
    echo "PostgreSQL is ready!"
    break
  fi
  
  echo "PostgreSQL not ready yet. Waiting..."
  sleep 5
done

if [ $COUNTER -eq $MAX_ATTEMPTS ]; then
  echo "Failed to connect to PostgreSQL after multiple attempts. Starting app anyway..."
fi

# Run migrations
echo "Running database migrations..."
node scripts/db-migration.js

# Start the application
echo "Starting application..."
node index.js
