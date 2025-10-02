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

# Conditionally run images example if EXAMPLE_IMAGE_PATH is set
if [ -n "$EXAMPLE_IMAGE_PATH" ]; then
  echo ""
  echo "========================================="
  echo "Running: images.ts ($EXAMPLE_IMAGE_PATH)"
  echo "========================================="
  npx tsx examples/images.ts "$EXAMPLE_IMAGE_PATH" || echo "❌ Failed: images.ts"
else
  echo ""
  echo "⚠️  Skipping images.ts (set EXAMPLE_IMAGE_PATH to run)"
fi

echo ""
echo "✅ All examples completed!"
