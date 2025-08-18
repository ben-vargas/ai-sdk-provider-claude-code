#!/bin/bash

# Build once
echo "Building project..."
npm run build

# List of all examples
examples=(
  "basic-usage"
  "streaming"
  "conversation-history"
  "custom-config"
  "generate-object-basic"
  "generate-object-nested"
  "generate-object-constraints"
  "generate-object"
  "tool-management"
  "long-running-tasks"
  "abort-signal"
  "check-cli"
  "integration-test"
  "limitations"
)

# Run each example
for example in "${examples[@]}"; do
  echo ""
  echo "========================================="
  echo "Running: $example.ts"
  echo "========================================="
  npx tsx "examples/$example.ts"
  
  # Check if the command succeeded
  if [ $? -ne 0 ]; then
    echo "❌ Failed: $example.ts"
  fi
done

echo ""
echo "✅ All examples completed!"