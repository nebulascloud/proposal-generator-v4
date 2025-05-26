# Docker Setup for Proposal Generator

This document provides instructions for running the Proposal Generator application using Docker containers.

## Overview

The application runs in two separate containers:
1. **App Container**: Node.js application
2. **Database Container**: PostgreSQL database

## Prerequisites

- Docker and Docker Compose installed on your system
- Basic understanding of Docker and containerization

## Quick Start

1. Create a `.env` file with your environment variables:
   ```
   NODE_ENV=production
   OPENAI_API_KEY=your_openai_api_key
   POSTGRES_USER=pguser
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=proposal_generator
   ```

2. Start the containers:
   ```bash
   docker-compose up -d
   ```

3. Check the logs:
   ```bash
   docker-compose logs -f
   ```

4. Access the application:
   - Main application: http://localhost:3000
   - Monitoring UI: http://localhost:3000/monitor

5. Stop the containers:
   ```bash
   docker-compose down
   ```

## Container Details

### App Container

- Based on Node.js 18 Alpine
- Includes Chromium for PDF generation
- Runs database migrations on startup
- Waits for database to be available before starting

### Database Container

- PostgreSQL 14 Alpine
- Persistent volume for data storage
- Optimized for message storage and retrieval

## Environment Variables

### Required Variables

- `OPENAI_API_KEY`: Your OpenAI API key

### Optional Variables

- `NODE_ENV`: Set to 'production' for production mode (default)
- `PORT`: Application port (default: 3000)
- `POSTGRES_USER`: Database username (default: pguser)
- `POSTGRES_PASSWORD`: Database password (default: pgpassword)
- `POSTGRES_DB`: Database name (default: proposal_generator)

## Data Persistence

Database data is stored in a Docker volume named `postgres_data`. This ensures that your data persists even if the containers are removed.

## Manual Migrations

If you need to run migrations manually:

```bash
# Enter the app container
docker-compose exec app /bin/sh

# Run migrations
node scripts/db-migration.js
```

## Troubleshooting

### Database Connection Issues

If the app can't connect to the database:

1. Check if the database container is running:
   ```bash
   docker-compose ps
   ```

2. Check database logs:
   ```bash
   docker-compose logs postgres
   ```

3. Try restarting the services:
   ```bash
   docker-compose restart
   ```

### Application Errors

Check application logs:
```bash
docker-compose logs app
```
