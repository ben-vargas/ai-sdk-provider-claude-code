import { readFileSync } from 'node:fs';
import { extname, basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    throw new Error(
      `Unsupported image extension "${ext}". Supported: ${Object.keys(SUPPORTED_EXTENSIONS).join(', ')}`
    );
  }

  const contents = readFileSync(filePath);
  const base64 = contents.toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

async function main() {
  // Use bundled bull.webp as default if no path provided
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const defaultImagePath = join(__dirname, 'bull.webp');

  const filePath = process.argv[2] || defaultImagePath;
  if (!process.argv[2]) {
    console.log(`Using default image: ${defaultImagePath}`);
    console.log(
      'Tip: Pass a custom image path as argument: npx tsx examples/images.ts /path/to/image.png\n'
    );
  }

  const dataUrl = toDataUrl(filePath);

  const result = streamText({
    model: claudeCode('haiku', { streamingInput: 'always' }),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Describe the mood conveyed by "${basename(filePath)}" in one sentence.`,
          },
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

main().catch((error) => {
  console.error('Error while streaming image prompt:', error);
  process.exitCode = 1;
});
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
