#!/usr/bin/env bash
# Ensure execution from project root
topdir=$(dirname "${BASH_SOURCE[0]}")/..
cd "${topdir}"
export NODE_ENV=test  # Ensure test environment for stubbed agent behavior
set -xeuo pipefail  # exit on error, print commands

echo "[Integration] Script started at $(date) with PID $$"

# Detect Docker Compose command
if command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  DC="docker compose"
fi
echo "[Integration] Using Compose command: $DC"

# Build and start containers
echo "[Integration] Building and starting Docker containers..."
${DC} up -d --build

# Give service time to initialize
echo "[Integration] Waiting for service to be ready..."
sleep 5

BASE_URL="http://localhost:3000"

# Check GET endpoints
GET_ENDPOINTS=(
  "/"
  "/health"
  "/proposals"
)
for path in "${GET_ENDPOINTS[@]}"; do
  echo "- GET $BASE_URL$path"
  # Capture response body and status
  resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL$path")
  status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
  body=$(echo "$resp" | sed '
$ d')
  echo "  HTTP $status"
  echo "  Response body: $body"
done

# Test creating a standard proposal
echo "- POST $BASE_URL/proposals"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H 'Content-Type: application/json' \
  -d '{"title":"Test","client":"Client","useDefaultTemplate":true,"details":"Details"}' \
  -X POST "$BASE_URL/proposals")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"

# Test HTML and PDF rendering of proposal id 1
echo "- GET $BASE_URL/proposals/1/html"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/proposals/1/html")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"
echo "- GET $BASE_URL/proposals/1/pdf"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/proposals/1/pdf")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body Length: ${#body} bytes"

# Check POST endpoints with valid payloads
echo "- POST $BASE_URL/agents/proposals"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H 'Content-Type: application/json' \
  -d '{"title":"Test","client":"Client","details":"Details"}' \
  -X POST "$BASE_URL/agents/proposals")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"

echo "- POST $BASE_URL/agents/assistants"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H 'Content-Type: application/json' \
  -d '{"role":"Role","instructions":"Instr"}' \
  -X POST "$BASE_URL/agents/assistants")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"

echo "- POST $BASE_URL/agents/orchestrate"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H 'Content-Type: application/json' \
  -d '{"title":"Test","client":"Client","details":"Details"}' \
  -X POST "$BASE_URL/agents/orchestrate")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"
# Extract orchestration ID
orch_id=$(echo "$body" | sed -E 's/.*"id":([0-9]+).*/\1/')
echo "- GET orchestration record for ID $orch_id"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/agents/orchestrate/$orch_id")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: ${body:0:200}..."
echo "- GET orchestration status for ID $orch_id"
resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/agents/orchestrate/$orch_id/status")
status=$(echo "$resp" | sed -n 's/.*HTTP_STATUS://p')
body=$(echo "$resp" | sed '
$ d')
echo "  HTTP $status"
echo "  Response body: $body"

# Teardown
echo "[Integration] Tearing down containers..."
${DC} down

echo "[Integration] Completed successfully."
