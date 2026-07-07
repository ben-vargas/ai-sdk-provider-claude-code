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

  it.each([
    {
      label: 'wildcard byte',
      mediaType: 'image/*',
      data: new Uint8Array([137, 80, 78, 71]),
      expectedMediaType: 'image/png',
      expectedBase64: 'iVBORw==',
    },
    {
      label: 'top-level byte',
      mediaType: 'image',
      data: new Uint8Array([255, 216]),
      expectedMediaType: 'image/jpeg',
      expectedBase64: '/9g=',
    },
    {
      label: 'wildcard base64',
      mediaType: 'image/*',
      data: 'iVBORw==',
      expectedMediaType: 'image/png',
      expectedBase64: 'iVBORw==',
    },
    {
      label: 'wildcard data URL',
      mediaType: 'image/*',
      data: 'data:image/*;base64,iVBORw==',
      expectedMediaType: 'image/png',
      expectedBase64: 'iVBORw==',
    },
    {
      label: 'wildcard provider base64',
      mediaType: 'image/*',
      data: 'base64:image/*,iVBORw==',
      expectedMediaType: 'image/png',
      expectedBase64: 'iVBORw==',
    },
  ])(
    'detects concrete image media type for $label data',
    ({ mediaType, data, expectedMediaType, expectedBase64 }) => {
      const prompt = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Detected image.' },
            { type: 'file', mediaType, data: { type: 'data', data } },
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
          media_type: expectedMediaType,
          data: expectedBase64,
        },
      });
    }
  );

  it('encodes only the selected Uint8Array view range for byte images', () => {
    const backingBytes = new Uint8Array([0, 137, 80, 78, 71, 0]);
    const imageBytes = backingBytes.subarray(1, 5);
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Subarray image.' },
          { type: 'file', mediaType: 'image/*', data: { type: 'data', data: imageBytes } },
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
        media_type: 'image/png',
        data: 'iVBORw==',
      },
    });
  });

  it('warns when generic image byte data cannot be detected', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Unknown image.' },
          {
            type: 'file',
            mediaType: 'image/*',
            data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(false);
    expect(result.warnings).toContain('Unable to convert image content; supply base64/data URLs.');
    expect(result.streamingContentParts).toHaveLength(1);
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
