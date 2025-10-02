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
  "hooks-callbacks"
  "sdk-tools-callbacks"
  "tool-streaming"
  "images"
)

# Run each example
for example in "${examples[@]}"; do
  echo ""
  echo "========================================="
  echo "Running: $example.ts"
  echo "========================================="

  # images.ts optionally accepts a path argument
  if [ "$example" = "images" ] && [ -n "$EXAMPLE_IMAGE_PATH" ]; then
    npx tsx "examples/$example.ts" "$EXAMPLE_IMAGE_PATH"
  else
    npx tsx "examples/$example.ts"
  fi

  # Check if the command succeeded
  if [ $? -ne 0 ]; then
    echo "❌ Failed: $example.ts"
  fi
done

echo ""
echo "✅ All examples completed!"
