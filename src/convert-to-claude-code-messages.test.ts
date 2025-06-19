import { describe, it, expect, vi } from 'vitest';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';

describe('convertToClaudeCodeMessages', () => {
  it('should convert a simple user message', () => {
    const result = convertToClaudeCodeMessages([
      { role: 'user', content: 'Hello, Claude!' }
    ]);
    
    expect(result.messagesPrompt).toBe('Human: Hello, Claude!');
    expect(result.systemPrompt).toBeUndefined();
  });

  it('should convert a simple assistant message', () => {
    const result = convertToClaudeCodeMessages([
      { role: 'assistant', content: 'Hello! How can I help you?' }
    ]);
    
    expect(result.messagesPrompt).toBe('Assistant: Hello! How can I help you?');
    expect(result.systemPrompt).toBeUndefined();
  });

  it('should handle system message', () => {
    const result = convertToClaudeCodeMessages([
      { role: 'system', content: 'You are a helpful assistant.' }
    ]);
    
    expect(result.messagesPrompt).toBe('You are a helpful assistant.');
    expect(result.systemPrompt).toBe('You are a helpful assistant.');
  });

  it('should handle a conversation with multiple messages', () => {
    const result = convertToClaudeCodeMessages([
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '2+2 equals 4.' },
      { role: 'user', content: 'Thanks!' }
    ]);
    
    expect(result.systemPrompt).toBe('Be helpful.');
    expect(result.messagesPrompt).toBe('Be helpful.\n\nHuman: What is 2+2?\n\nAssistant: 2+2 equals 4.\n\nHuman: Thanks!');
  });

  it('should handle multi-part text messages', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'world!' }
        ]
      }
    ]);
    
    expect(result.messagesPrompt).toBe('Human: Hello\n, \nworld!');
  });

  it('should warn for image content but not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const result = convertToClaudeCodeMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this:' },
          { type: 'image', image: new Uint8Array([1, 2, 3]) }
        ]
      }
    ]);
    
    expect(warnSpy).toHaveBeenCalledWith('Claude Code CLI does not support image inputs. Images will be ignored.');
    expect(result.messagesPrompt).toBe('Human: Look at this:');
    warnSpy.mockRestore();
  });

  it('should handle unknown content types gracefully', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this file:' },
          { type: 'file' as any, data: new Uint8Array([1, 2, 3]), mimeType: 'text/plain' }
        ]
      }
    ]);
    
    // Unknown content types are filtered out
    expect(result.messagesPrompt).toBe('Human: Check this file:');
  });

  it('should convert tool messages', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-123',
            toolName: 'calculator',
            result: { answer: 42 },
            isError: false
          }
        ]
      }
    ]);
    
    expect(result.messagesPrompt).toBe('Tool Result (calculator): {"answer":42}');
  });

  it('should handle tool error messages', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-456',
            toolName: 'search',
            result: 'Network error',
            isError: true
          }
        ]
      }
    ]);
    
    expect(result.messagesPrompt).toBe('Tool Result (search): "Network error"');
  });

  it('should handle empty content array', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'user',
        content: []
      }
    ]);
    
    expect(result.messagesPrompt).toBe('');
  });

  it('should handle undefined content gracefully', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: undefined as any }
        ]
      }
    ]);
    
    expect(result.messagesPrompt).toBe('');
  });

  it('should handle complex tool results', () => {
    const result = convertToClaudeCodeMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-789',
            toolName: 'database',
            result: {
              users: [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' }
              ],
              count: 2
            },
            isError: false
          }
        ]
      }
    ]);
    
    expect(result.messagesPrompt).toBe('Tool Result (database): {"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}],"count":2}');
  });

  it('should handle consecutive messages properly', () => {
    const result = convertToClaudeCodeMessages([
      { role: 'user', content: 'First message' },
      { role: 'user', content: 'Second message' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Third message' }
    ]);
    
    expect(result.messagesPrompt).toBe('Human: First message\n\nHuman: Second message\n\nAssistant: Response\n\nHuman: Third message');
  });
});