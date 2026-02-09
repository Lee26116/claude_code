#!/bin/bash
# Deploy script for Claude Code Dashboard
# Usage: ./deploy.sh

set -e

echo "=== Claude Code Dashboard Deployment ==="

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please edit .env with your credentials, then run this script again."
    exit 1
fi

# Build and start containers
echo "Building and starting containers..."
docker compose up -d --build

echo ""
echo "=== Deployment complete ==="
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
