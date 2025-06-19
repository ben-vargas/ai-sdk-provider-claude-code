# Code Review Plan for ai-sdk-provider-claude-code

This document outlines the issues identified during code review and the detailed plan to address each one.

## 1. Critical Issues

### 1.1 TypeScript Type Safety Issues

**Problem Description:**
- Multiple instances of `as any` type assertions in `src/claude-code-language-model.ts`:
  - Line 113: `permissionMode: this.settings.permissionMode as any`
  - Line 118: `mcpServers: this.settings.mcpServers as any`
  - Line 242: `permissionMode: this.settings.permissionMode as any`
  - Line 247: `mcpServers: this.settings.mcpServers as any`
- These assertions bypass TypeScript's type checking and could lead to runtime errors

**Root Cause:**
The SDK expects specific string literal types for `permissionMode` and specific object shapes for `mcpServers`, but our types are more generic.

**Proposed Fix:**
1. Import the proper types from `@anthropic-ai/claude-code` SDK
2. Update our `ClaudeCodeSettings` interface to match SDK expectations
3. Remove all `as any` assertions
4. Add type guards or validation to ensure type safety

**Implementation Steps:**
1. Check the SDK's exported types for `Options` interface
2. Align our types with the SDK's expected types
3. Update the interface definitions in `src/types.ts`
4. Remove type assertions in `src/claude-code-language-model.ts`

### 1.2 Code Duplication in Query Options

**Problem Description:**
- The `queryOptions` object creation is duplicated between `doGenerate` (lines 101-119) and `doStream` (lines 230-248)
- This violates DRY principle and makes maintenance harder
- Any change needs to be made in two places, increasing risk of bugs

**Root Cause:**
No abstraction was created when implementing both methods.

**Proposed Fix:**
1. Create a private method `createQueryOptions()` that returns the options object
2. Call this method from both `doGenerate` and `doStream`
3. This ensures consistency and single point of maintenance

**Implementation Steps:**
1. Add private method `createQueryOptions(abortController: AbortController): Options`
2. Move the duplicated code into this method
3. Replace duplicated code in both methods with calls to the new method

## 2. Error Handling Issues

### 2.1 Inconsistent Error Handling

**Problem Description:**
- `doGenerate` and `doStream` have slightly different error handling logic
- Stream errors are not properly propagated as stream error parts
- Missing specific error types for different failure scenarios

**Root Cause:**
Error handling was implemented separately for each method without a unified approach.

**Proposed Fix:**
1. Create a unified error handling method
2. Ensure all errors are properly typed and include relevant metadata
3. For streaming, emit errors as proper stream error parts

**Implementation Steps:**
1. Create `handleClaudeCodeError(error: any, messagesPrompt: string)` method
2. Implement consistent error categorization
3. Update both methods to use the unified handler
4. Add stream error parts for streaming errors

### 2.2 JSON Extraction Error Handling

**Problem Description:**
- In `src/extract-json.ts`, when JSON parsing fails, it returns the original text
- This could cause silent failures in object generation mode
- No error reporting when JSON extraction fails

**Root Cause:**
The function was designed to be permissive but lacks error reporting.

**Proposed Fix:**
1. Add optional error callback or throw parameter
2. Log warnings when JSON extraction fails
3. Provide better error messages for debugging

**Implementation Steps:**
1. Add optional `options` parameter with `throwOnError` flag
2. Implement proper error messages for different failure modes
3. Add logging for debugging purposes

## 3. Configuration Issues

### 3.1 Multiple Vitest Configurations

**Problem Description:**
- Three separate vitest config files: `vitest.config.ts`, `vitest.node.config.js`, `vitest.edge.config.js`
- Redundant configuration between files
- Increases maintenance burden

**Root Cause:**
Separate configs were created for different environments without consolidation.

**Proposed Fix:**
1. Consolidate into a single config with environment-specific overrides
2. Use Vitest's project feature for different environments
3. Remove redundant files

**Implementation Steps:**
1. Create unified `vitest.config.ts` with projects array
2. Define node and edge configurations within the single file
3. Delete redundant config files
4. Update package.json scripts

### 3.2 ESLint Configuration Inconsistencies

**Problem Description:**
- Test files are in ignore patterns but `@typescript-eslint/no-unused-vars` is configured
- Examples directory is ignored but contains TypeScript files that should be linted

**Root Cause:**
Overly broad ignore patterns.

**Proposed Fix:**
1. Remove test files from ignore patterns
2. Add test-specific rules if needed
3. Ensure examples are properly linted

**Implementation Steps:**
1. Update `eslint.config.js` ignore patterns
2. Add test-specific rule overrides
3. Run linter and fix any issues

## 4. Documentation Issues

### 4.1 Claude Version Inconsistency

**Problem Description:**
- README mentions "Claude 3 Opus and Sonnet"
- Package.json keywords include "claude-code"
- Recent commits mention "Claude 4 models"
- User confusion about which Claude version is supported

**Root Cause:**
Documentation wasn't updated consistently when upgrading Claude versions.

**Proposed Fix:**
1. Audit all documentation for version references
2. Update to consistent "Claude 4" references
3. Add clear version compatibility section

**Implementation Steps:**
1. Update README.md to reference Claude 4
2. Update CHANGELOG.md with version clarification
3. Add compatibility section to README
4. Update package.json description

### 4.2 Missing API Documentation

**Problem Description:**
- No JSDoc comments on public methods and classes
- Missing documentation for error types
- No clear documentation of method parameters and return types

**Root Cause:**
Documentation was not prioritized during initial development.

**Proposed Fix:**
1. Add comprehensive JSDoc comments to all public APIs
2. Document all error scenarios
3. Add examples in JSDoc comments

**Implementation Steps:**
1. Add JSDoc to all exported functions and classes
2. Document parameters, return types, and thrown errors
3. Add usage examples where appropriate

## 5. Test Coverage Issues

### 5.1 Minimal Test Coverage

**Problem Description:**
- Only one test file with basic tests
- Missing tests for error scenarios
- No tests for streaming functionality
- No tests for object generation

**Root Cause:**
Tests were not comprehensive during initial development.

**Proposed Fix:**
1. Add comprehensive test suite
2. Achieve at least 80% code coverage
3. Test all error scenarios and edge cases

**Implementation Steps:**
1. Create test files for each source file
2. Add tests for happy path scenarios
3. Add tests for error conditions
4. Add tests for edge cases
5. Set up coverage reporting

## 6. Security and Validation Issues

### 6.1 Missing Input Validation

**Problem Description:**
- No validation of settings passed to the model
- No validation of model IDs
- No sanitization of prompts
- Missing validation of sessionId format

**Root Cause:**
Input validation was not implemented.

**Proposed Fix:**
1. Add validation for all user inputs
2. Validate model IDs against known models
3. Sanitize prompts to prevent injection
4. Validate sessionId format

**Implementation Steps:**
1. Create validation utility functions
2. Add validation in constructor and methods
3. Add appropriate error messages
4. Test validation logic

### 6.2 Dependency Version Inconsistency

**Problem Description:**
- Mix of exact versions and version ranges in package.json
- Could lead to unexpected behavior with different installations

**Root Cause:**
No consistent versioning strategy.

**Proposed Fix:**
1. Use exact versions for all dependencies
2. Use version ranges only for peer dependencies
3. Document versioning strategy

**Implementation Steps:**
1. Update package.json to use exact versions
2. Run npm install to update lock file
3. Test with fresh installation

## 7. Unused Code

### 7.1 Unused map-claude-code-finish-reason.ts

**Problem Description:**
- The file `src/map-claude-code-finish-reason.ts` exists but is never imported or used
- The functionality is implemented inline in the language model

**Root Cause:**
Code was refactored but file wasn't removed.

**Proposed Fix:**
1. Either use the function or remove the file
2. If keeping, integrate it into the main code

**Implementation Steps:**
1. Check if the function provides value
2. If yes, integrate it into claude-code-language-model.ts
3. If no, delete the file
4. Update any imports/exports

## Progress Tracking

- [x] 1.1 TypeScript Type Safety Issues [COMPLETED]
- [x] 1.2 Code Duplication in Query Options [COMPLETED]
- [x] 2.1 Inconsistent Error Handling [COMPLETED]
- [x] 2.2 JSON Extraction Error Handling [COMPLETED]
- [ ] 3.1 Multiple Vitest Configurations
- [x] 3.2 ESLint Configuration Inconsistencies [COMPLETED]
- [x] 4.1 Claude Version Inconsistency [COMPLETED]
- [x] 4.2 Missing API Documentation [COMPLETED]
- [ ] 5.1 Minimal Test Coverage
- [ ] 6.1 Missing Input Validation
- [ ] 6.2 Dependency Version Inconsistency
- [ ] 7.1 Unused map-claude-code-finish-reason.ts

## Priority Order

1. **Critical**: 1.1, 1.2 (Type safety and code duplication)
2. **High**: 2.1, 2.2, 6.1 (Error handling and validation)
3. **Medium**: 4.1, 4.2, 5.1 (Documentation and tests)
4. **Low**: 3.1, 3.2, 6.2, 7.1 (Configuration and cleanup)