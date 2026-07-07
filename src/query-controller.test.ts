import { describe, expect, it, vi } from 'vitest';
import { createClaudeCodeQueryController } from './query-controller.js';
import type {
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  Query,
  Settings,
} from '@anthropic-ai/claude-agent-sdk';

function createMockQuery() {
  const methods = {
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setMcpPermissionModeOverride: vi.fn().mockResolvedValue({}),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined),
    setMcpServers: vi.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
    getContextUsage: vi.fn().mockResolvedValue({
      categories: [],
      totalTokens: 0,
      maxTokens: 0,
      rawMaxTokens: 0,
      percentage: 0,
      gridRows: [],
      model: 'sonnet',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null,
    }),
    rewindFiles: vi.fn().mockResolvedValue({ canRewind: true }),
    streamInput: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    backgroundTasks: vi.fn().mockResolvedValue(true),
  };

  const query = {
    ...methods,
    async next() {
      return { done: true as const, value: undefined };
    },
    async return() {
      return { done: true as const, value: undefined };
    },
    async throw(error?: unknown) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as Query;

  return { query, methods };
}

describe('createClaudeCodeQueryController', () => {
  it('exposes the raw Query by identity', () => {
    const { query } = createMockQuery();

    const controller = createClaudeCodeQueryController(query);

    expect(controller.rawQuery).toBe(query);
  });

  it('delegates interrupt to the Query', async () => {
    const { query, methods } = createMockQuery();
    const controller = createClaudeCodeQueryController(query);

    await controller.interrupt();

    expect(methods.interrupt).toHaveBeenCalledTimes(1);
  });

  it('delegates applyFlagSettings with nullable flag settings to the Query', async () => {
    const { query, methods } = createMockQuery();
    const settings: { [K in keyof Settings]?: Settings[K] | null } = {
      apiKeyHelper: null,
      respectGitignore: false,
    };
    const controller = createClaudeCodeQueryController(query);

    await controller.applyFlagSettings(settings);

    expect(methods.applyFlagSettings).toHaveBeenCalledWith(settings);
  });

  it('delegates mcpServerStatus and returns the Query result', async () => {
    const { query, methods } = createMockQuery();
    const statuses: McpServerStatus[] = [{ name: 'filesystem', status: 'connected' }];
    methods.mcpServerStatus.mockResolvedValueOnce(statuses);
    const controller = createClaudeCodeQueryController(query);

    await expect(controller.mcpServerStatus()).resolves.toBe(statuses);
    expect(methods.mcpServerStatus).toHaveBeenCalledTimes(1);
  });

  it('delegates setMcpServers with the provided server map', async () => {
    const { query, methods } = createMockQuery();
    const servers: Record<string, McpServerConfig> = {
      workspace: { type: 'stdio', command: 'node', args: ['server.js'] },
    };
    const result: McpSetServersResult = { added: ['workspace'], removed: [], errors: {} };
    methods.setMcpServers.mockResolvedValueOnce(result);
    const controller = createClaudeCodeQueryController(query);

    await expect(controller.setMcpServers(servers)).resolves.toBe(result);
    expect(methods.setMcpServers).toHaveBeenCalledWith(servers);
  });

  it('delegates setMcpPermissionModeOverride with the provided server mode', async () => {
    const { query, methods } = createMockQuery();
    const result = { warning: 'server not currently connected' };
    methods.setMcpPermissionModeOverride.mockResolvedValueOnce(result);
    const controller = createClaudeCodeQueryController(query);

    await expect(controller.setMcpPermissionModeOverride('filesystem', 'auto')).resolves.toBe(
      result
    );
    expect(methods.setMcpPermissionModeOverride).toHaveBeenCalledWith('filesystem', 'auto');
  });

  it('delegates stopTask to the Query', async () => {
    const { query, methods } = createMockQuery();
    const controller = createClaudeCodeQueryController(query);

    await controller.stopTask('task-123');

    expect(methods.stopTask).toHaveBeenCalledWith('task-123');
  });

  it('delegates backgroundTasks with and without a tool use id', async () => {
    const { query, methods } = createMockQuery();
    methods.backgroundTasks.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const controller = createClaudeCodeQueryController(query);

    await expect(controller.backgroundTasks()).resolves.toBe(true);
    await expect(controller.backgroundTasks('tool-use-1')).resolves.toBe(false);
    expect(methods.backgroundTasks).toHaveBeenNthCalledWith(1);
    expect(methods.backgroundTasks).toHaveBeenNthCalledWith(2, 'tool-use-1');
  });

  it('does not throw on construction when streamInput is absent', () => {
    const { query } = createMockQuery();
    delete (query as Partial<Query>).streamInput;

    const controller = createClaudeCodeQueryController(query);

    expect(controller.streamInput).toBeUndefined();
  });
});
