import { describe, it, expect } from 'vitest';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';

describe('convertToClaudeCodeMessages (videos)', () => {
  it('includes data URL videos in streaming content', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a sample video.' },
          {
            type: 'file',
            mediaType: 'video/mp4',
            data: { type: 'url', url: new URL('data:video/mp4;base64,aGVsbG8=') },
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
      text: 'Human: Here is a sample video.',
    });
    expect(result.streamingContentParts[1]).toEqual({
      type: 'video',
      source: {
        type: 'base64',
        media_type: 'video/mp4',
        data: 'aGVsbG8=',
      },
    });
  });

  it('includes base64 videos when a concrete media type is provided', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inline base64 video.' },
          { type: 'file', mediaType: 'video/quicktime', data: { type: 'data', data: 'AQID' } },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts[1]).toEqual({
      type: 'video',
      source: {
        type: 'base64',
        media_type: 'video/quicktime',
        data: 'AQID',
      },
    });
  });

  it.each([
    {
      label: 'wildcard byte',
      mediaType: 'video/*',
      data: new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]),
      expectedMediaType: 'video/mp4',
      expectedBase64: 'AAAAIGZ0eXA=',
    },
    {
      label: 'top-level byte',
      mediaType: 'video',
      data: new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]),
      expectedMediaType: 'video/mp4',
      expectedBase64: 'AAAAIGZ0eXA=',
    },
    {
      label: 'wildcard base64',
      mediaType: 'video/*',
      data: 'AAAAIGZ0eXA=',
      expectedMediaType: 'video/mp4',
      expectedBase64: 'AAAAIGZ0eXA=',
    },
    {
      label: 'wildcard data URL',
      mediaType: 'video/*',
      data: 'data:video/*;base64,AAAAIGZ0eXA=',
      expectedMediaType: 'video/mp4',
      expectedBase64: 'AAAAIGZ0eXA=',
    },
    {
      label: 'wildcard provider base64',
      mediaType: 'video/*',
      data: 'base64:video/*,AAAAIGZ0eXA=',
      expectedMediaType: 'video/mp4',
      expectedBase64: 'AAAAIGZ0eXA=',
    },
  ])(
    'detects concrete video media type for $label data',
    ({ mediaType, data, expectedMediaType, expectedBase64 }) => {
      const prompt = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Detected video.' },
            { type: 'file', mediaType, data: { type: 'data', data } },
          ],
        },
      ] satisfies LanguageModelV4Prompt;

      const result = convertToClaudeCodeMessages(prompt);

      expect(result.warnings).toBeUndefined();
      expect(result.hasImageParts).toBe(true);
      expect(result.streamingContentParts[1]).toEqual({
        type: 'video',
        source: {
          type: 'base64',
          media_type: expectedMediaType,
          data: expectedBase64,
        },
      });
    }
  );

  it('encodes only the selected Uint8Array view range for byte videos', () => {
    const backingBytes = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 0, 0]);
    const videoBytes = backingBytes.subarray(0, 8);
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Subarray video.' },
          { type: 'file', mediaType: 'video/*', data: { type: 'data', data: videoBytes } },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(true);
    expect(result.streamingContentParts[1]).toEqual({
      type: 'video',
      source: {
        type: 'base64',
        media_type: 'video/mp4',
        data: 'AAAAIGZ0eXA=',
      },
    });
  });

  it('warns when generic video byte data cannot be detected', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Unknown video.' },
          {
            type: 'file',
            mediaType: 'video/*',
            data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(false);
    expect(result.warnings).toContain('Unable to convert video content; supply base64/data URLs.');
    expect(result.streamingContentParts).toHaveLength(1);
  });

  it('warns and skips HTTP video URLs', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Remote video' },
          {
            type: 'file',
            mediaType: 'video/mp4',
            data: { type: 'url', url: new URL('https://example.com/clip.mp4') },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(false);
    expect(result.warnings).toContain(
      'Video URLs are not supported by this provider; supply base64/data URLs.'
    );
    expect(result.streamingContentParts).toHaveLength(1);
  });

  it('warns and skips non-data video URL schemes instead of encoding the URL string', () => {
    const prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Local video' },
          {
            type: 'file',
            mediaType: 'video/mp4',
            data: { type: 'url', url: new URL('file:///tmp/clip.mp4') },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.hasImageParts).toBe(false);
    expect(result.warnings).toContain(
      'Video URLs are not supported by this provider; supply base64/data URLs.'
    );
    expect(result.streamingContentParts).toHaveLength(1);
    expect(JSON.stringify(result.streamingContentParts)).not.toContain('file:///tmp/clip.mp4');
  });

  it('forwards video file parts from assistant history into streaming content', () => {
    const prompt = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Attached clip.' },
          {
            type: 'file',
            mediaType: 'video/mp4',
            data: { type: 'data', data: 'aGVsbG8=' },
          },
        ],
      },
    ] satisfies LanguageModelV4Prompt;

    const result = convertToClaudeCodeMessages(prompt);

    expect(result.warnings).toBeUndefined();
    expect(result.hasImageParts).toBe(true);
    expect(
      (
        result.streamingContentParts as Array<{
          type: string;
          source?: { type?: string; media_type?: string };
        }>
      ).some(
        (part) =>
          part.type === 'video' &&
          part.source?.type === 'base64' &&
          part.source?.media_type === 'video/mp4'
      )
    ).toBe(true);
  });
});
