# V5-Beta Migration Plan

The goal of this migration is to update the `ai-sdk-provider-claude-code` to be compatible with the Vercel AI SDK v5-beta. This document outlines the plan that was followed to achieve this.

## Key Areas of Change

The migration focused on the following key areas:

1.  **Dependency Upgrades:** The first step was to update all relevant `@ai-sdk` and `ai` packages to their `@beta` versions. This brought in the new `LanguageModelV2` architecture and other breaking changes.

2.  **`LanguageModelV2` Adoption:** The core of the migration was to rewrite the `ClaudeCodeLanguageModel` to conform to the new `LanguageModelV2` interface. This involved the following:
    - Changing the `doStream` and `doGenerate` methods to handle the new `UIMessage` and `ModelMessage` formats.
    - Adopting the "content-first" design, where all outputs are treated as ordered content parts.
    - Ensuring type safety with the new `LanguageModelV2` types.

3.  **Message Overhaul:** The provider was updated to handle the new `UIMessage` and `ModelMessage` types. This meant that the `convertToClaudeCodeMessages` function was updated to accept `ModelMessage`s and convert them to the format that the Claude API expects.

4.  **Server-Sent Events (SSE):** The provider was updated to work with the new SSE-based streaming protocol. This required changes to how the streaming responses are handled and formatted.

5.  **Tool Handling:** The provider was updated to handle the new type-safe tool calls. This involved changes to how tools are defined and how tool calls are processed.

6.  **Examples and Tests:** All examples and tests were updated to use the new v5-beta APIs. This was a good way to validate the migration and ensure that everything was working as expected.
