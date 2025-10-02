# V5-Beta Migration Tasks

This document outlines the sequential tasks that were executed to migrate the `ai-sdk-provider-claude-code` to be compatible with the Vercel AI SDK v5-beta.

## Phase 1: Setup and Dependency Updates

1.  **Update `package.json`:**
    - Update `ai` to `@beta`.
    - Update `@ai-sdk/provider` to `@beta`.
    - Update `@ai-sdk/provider-utils` to `@beta`.
    - Run `npm install` to install the new dependencies.

## Phase 2: Core Provider Migration

1.  **Update `ClaudeCodeLanguageModel`:**
    - Modify the class to implement the `LanguageModelV2` interface.
    - Update the `doStream` and `doGenerate` methods to handle the new message formats and streaming protocol.

2.  **Update `convertToClaudeCodeMessages`:**
    - Modify the function to accept `ModelMessage`s as input.
    - Update the conversion logic to correctly transform `ModelMessage`s into the Claude API format.

3.  **Update `mapClaudeCodeFinishReason`:**
    - Review and update the finish reason mapping to align with any changes in the v5-beta API.

## Phase 3: Tooling and Error Handling

1.  **Update Tool Handling:**
    - Review the new type-safe tool call mechanism.
    - Update any tool-related logic in the provider to use the new APIs.

2.  **Update Error Handling:**
    - Review the error handling in the provider and update it to align with any changes in the v5-beta API.

## Phase 4: Validation and Testing

1.  **Update Examples:**
    - Go through each example in the `examples` directory and update it to use the new v5-beta APIs.
    - This involved updating how the `useChat` hook is used, how messages are handled, and how the provider is instantiated.

2.  **Update Tests:**
    - Go through each test file in the `src` directory and update it to use the new v5-beta APIs.
    - This involved updating how the language model is mocked and how the test assertions are written.

3.  **Run all tests and examples:**
    - Execute all tests and examples to ensure that the migration was successful and that there are no regressions.
