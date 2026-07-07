import { describe, it, expect } from 'vitest';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';

describe('convertToClaudeCodeMessages (images)', () => {
  it('includes data URL images in streaming content', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a sample image.' },
          {
            type: 'file',
            mediaType: 'image/*',
            data: { type: 'url', url: new URL('data:image/png;base64,aGVsbG8=') },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts).toHaveLength(2);
    expect(result.streamingContentParts[0]).toEqual({
      type: 'text',
      text: 'Human: Here is a sample image.',
    });
    expect(result.streamingContentParts[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'aGVsbG8=',
      },
    });
  });

  it('includes base64 images when mediaType is provided', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inline base64 image.' },
          { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: 'AQID' } },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: 'AQID',
      },
    });
  });

  it('warns and skips HTTP image URLs', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Remote image' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'url', url: new URL('https://example.com/image.png') },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(false);
    expect(result.warnings).toContain(
      'Image URLs are not supported by this provider; supply base64/data URLs.'
    );
    expect(result.streamingContentParts).toHaveLength(1);
  });

  it('accepts file parts with image media type', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'File part image.' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'AQID',
      },
    });
  });

  it('includes inline text file parts in the converted prompt', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this note:' },
          { type: 'file', mediaType: 'text/plain', data: { type: 'text', text: 'note body' } },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(false);
    expect(result.messagesPrompt).toBe('Human: Read this note:\nnote body');
  });
});
