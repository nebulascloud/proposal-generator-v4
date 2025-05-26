# Message Monitoring System

This document provides information about the message monitoring system implemented in the Proposal Generator application.

## Overview

The message monitoring system tracks all interactions with the OpenAI API, storing messages, agent information, and session data in a database. This allows for better debugging, troubleshooting, and insights into the proposal generation process.

## Setup

### Development Environment

For development, the application uses SQLite as the database:

1. Install dependencies:
   ```
   npm install
   ```

2. Run database migrations:
   ```
   npm run db:migrate
   ```

3. Start the application:
   ```
   npm start
   ```

### Production Environment with Docker

For production, the application uses PostgreSQL in a separate container:

1. Make sure Docker and Docker Compose are installed

2. Create a `.env` file with the following variables:
   ```
   NODE_ENV=production
   OPENAI_API_KEY=your_openai_api_key
   POSTGRES_USER=pguser
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=proposal_generator
   ```

3. Start the containers:
   ```
   npm run docker:up
   ```

4. To stop the containers:
   ```
   npm run docker:down
   ```

## Monitoring UI

The monitoring UI is available at `/monitor` when the application is running. It provides:

- List of all proposal generation sessions
- Message threads for each session
- Filtering by phase, agent, and message role
- Detailed view of each message

## Database Schema

The system uses three main tables:

1. **Messages**: Stores all messages sent to and received from the OpenAI API
2. **Agents**: Stores information about different agents and their instructions
3. **Sessions**: Groups messages by proposal generation session

## Docker Architecture

The Docker setup consists of two containers:

1. **App Container**: Node.js application that runs the Proposal Generator
2. **Database Container**: PostgreSQL database for storing monitoring data

Data persistence is handled through a Docker volume for the PostgreSQL data.

## Technical Implementation

- **Database ORM**: Knex.js
- **API Integration**: Messages are logged before and after API calls
- **UI**: Simple HTML/CSS/JS with Bootstrap for styling
