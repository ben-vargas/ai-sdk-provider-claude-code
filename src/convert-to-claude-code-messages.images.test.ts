import { describe, it, expect } from 'vitest';
import type { CoreMessage } from 'ai';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';

describe('convertToClaudeCodeMessages (images)', () => {
  it('includes data URL images in streaming content', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a sample image.' },
          { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
        ],
      },
    ] as CoreMessage[];

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

  it('includes base64 images when mimeType is provided', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inline base64 image.' },
          { type: 'image', image: { data: 'AQID', mimeType: 'image/jpeg' } },
        ],
      },
    ] as CoreMessage[];

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
          { type: 'image', image: 'https://example.com/image.png' },
        ],
      },
    ] as CoreMessage[];

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
          { type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' },
        ],
      },
    ] as CoreMessage[];

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'aGVsbG8=',
      },
    });
  });
});
