import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeCodeQueryController } from './types.js';

type QueryWithOptionalStreamInput = Omit<Query, 'streamInput'> & {
  streamInput?: Query['streamInput'];
};

/**
 * Creates a safe controller for common runtime operations on an Agent SDK Query.
 * The raw Query remains available as `rawQuery` for SDK features not wrapped here.
 */
export function createClaudeCodeQueryController(query: Query): ClaudeCodeQueryController {
  const controller: ClaudeCodeQueryController = {
    rawQuery: query,
    interrupt: () => query.interrupt(),
    setPermissionMode: (mode) => query.setPermissionMode(mode),
    setMcpPermissionModeOverride: (serverName, mode) =>
      query.setMcpPermissionModeOverride(serverName, mode),
    setModel: (model) => query.setModel(model),
    setMaxThinkingTokens: (maxThinkingTokens, thinkingDisplay) =>
      query.setMaxThinkingTokens(maxThinkingTokens, thinkingDisplay),
    applyFlagSettings: (settings) => query.applyFlagSettings(settings),
    mcpServerStatus: () => query.mcpServerStatus(),
    reconnectMcpServer: (serverName) => query.reconnectMcpServer(serverName),
    toggleMcpServer: (serverName, enabled) => query.toggleMcpServer(serverName, enabled),
    setMcpServers: (servers) => query.setMcpServers(servers),
    getContextUsage: () => query.getContextUsage(),
    rewindFiles: (userMessageId, options) => query.rewindFiles(userMessageId, options),
    stopTask: (taskId) => query.stopTask(taskId),
    backgroundTasks: (toolUseId) =>
      toolUseId === undefined ? query.backgroundTasks() : query.backgroundTasks(toolUseId),
  };

  const streamInput = (query as QueryWithOptionalStreamInput).streamInput;
  if (typeof streamInput === 'function') {
    controller.streamInput = (stream) => streamInput.call(query, stream);
  }

  return controller;
}
