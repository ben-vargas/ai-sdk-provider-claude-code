import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock the SDK module
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    tool: vi.fn((_name, _description, _inputSchema, _handler, _extras) => ({
      name: _name,
      description: _description,
      inputSchema: _inputSchema,
      handler: _handler,
      annotations: _extras?.annotations,
    })),
    createSdkMcpServer: vi.fn((_options) => ({
      type: 'sdk' as const,
      name: _options.name,
      instance: { tools: _options.tools },
    })),
  };
});

import { tool as mockTool } from '@anthropic-ai/claude-agent-sdk';
import { createCustomMcpServer } from './mcp-helpers.js';
import type { ToolAnnotations } from './mcp-helpers.js';

describe('createCustomMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward annotations to tool() when provided', () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
    };

    createCustomMcpServer({
      name: 'test-server',
      tools: {
        myTool: {
          description: 'A test tool',
          inputSchema: z.object({ query: z.string() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
          annotations,
        },
      },
    });

    expect(vi.mocked(mockTool)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(mockTool).mock.calls[0];
    expect(callArgs?.[0]).toBe('myTool');
    expect(callArgs?.[4]).toEqual({ annotations });
  });

  it('should pass undefined as 5th arg when annotations are not provided', () => {
    createCustomMcpServer({
      name: 'test-server',
      tools: {
        plainTool: {
          description: 'No annotations',
          inputSchema: z.object({ x: z.number() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      },
    });

    expect(vi.mocked(mockTool)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(mockTool).mock.calls[0];
    expect(callArgs?.[4]).toBeUndefined();
  });
});
