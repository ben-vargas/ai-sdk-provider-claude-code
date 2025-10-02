import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function toDataUrl(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mediaType = SUPPORTED_EXTENSIONS[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image extension "${ext}". Supported: ${Object.keys(SUPPORTED_EXTENSIONS).join(', ')}`);
  }

  const contents = readFileSync(filePath);
  const base64 = contents.toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

async function main() {
  // Default to bull.webp in examples directory if no path provided
  const filePath = process.argv[2] || new URL('bull.webp', import.meta.url).pathname;

  const dataUrl = toDataUrl(filePath);

  const result = streamText({
    model: claudeCode('sonnet', { streamingInput: 'always' }),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Describe the mood conveyed by "${basename(filePath)}" in one sentence.` },
          { type: 'image', image: dataUrl },
        ],
      },
    ],
  });

  process.stdout.write('Assistant: ');
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
}

main().catch(error => {
  console.error('Error while streaming image prompt:', error);
  process.exitCode = 1;
});
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
