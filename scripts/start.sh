#!/bin/bash
set -e

echo "=== UIPE Startup ==="

# 1. Check Ollama
echo "[1/3] Checking Ollama..."
if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "  OK Ollama is running"
  if curl -sf http://localhost:11434/api/tags | grep -q "qwen3-vl"; then
    echo "  OK qwen3-vl model available"
  else
    echo "  WARN qwen3-vl model not found. Run: ollama pull qwen3-vl:8b"
  fi
else
  echo "  WARN Ollama not running. Visual understanding (Tier B) will be unavailable."
  echo "       Start with: ollama serve"
fi

# 2. Check OmniParser
echo "[2/3] Checking OmniParser..."
if curl -sf http://localhost:8100/health > /dev/null 2>&1; then
  echo "  OK OmniParser V2 sidecar is running"
else
  echo "  WARN OmniParser not running. Element detection (Tier A) will fall back to Claude Vision."
  echo "       See UIPE-LOCAL-VISION-HANDOFF.md for setup instructions."
fi

# 3. Start UIPE MCP server
echo "[3/3] Starting UIPE MCP server..."
echo ""
node "$(dirname "$0")/../dist/src/mcp/index.js"
