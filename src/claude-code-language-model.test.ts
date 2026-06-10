import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';
import { getErrorMetadata, isAuthenticationError } from './errors.js';
import type { Logger } from './types.js';
import { APICallError, type LanguageModelV3StreamPart } from '@ai-sdk/provider';

// Extend stream part union locally to include provider-specific 'tool-error'
type ToolErrorPart = {
  type: 'tool-error';
  toolCallId: string;
  toolName: string;
  error: string;
  providerExecuted: true;
  providerMetadata?: Record<string, unknown>;
};
type ExtendedStreamPart = LanguageModelV3StreamPart | ToolErrorPart;

// Mock the SDK module with factory function
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
    // Note: real SDK may not export AbortError at runtime; test mock provides it
    AbortError: class AbortError extends Error {
      constructor(message?: string) {
        super(message);
        this.name = 'AbortError';
      }
    },
  };
});

// Import the mocked module to get typed references
import { query as mockQuery, AbortError as MockAbortError } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const STREAMING_WARNING_MESSAGE =
  "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

describe('ClaudeCodeLanguageModel', () => {
  let model: ClaudeCodeLanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();

    model = new ClaudeCodeLanguageModel({
      id: 'sonnet',
      settings: {},
    });
  });

  describe('doGenerate', () => {
    it('invokes onQueryCreated with the query response', async () => {
      const onQueryCreated = vi.fn();
      const modelWithHook = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onQueryCreated } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-onquery',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithHook.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      expect(onQueryCreated).toHaveBeenCalledTimes(1);
      expect(onQueryCreated).toHaveBeenCalledWith(mockResponse);
    });

    it('uses AsyncIterable prompt when streamingInput auto and canUseTool provided', async () => {
      const hooks = {} as any;
      const canUseTool = async () => ({ behavior: 'allow', updatedInput: {} });
      const modelWithStream = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { hooks, canUseTool, streamingInput: 'auto' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's2',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithStream.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call).toBeDefined();
      // AsyncIterable check
      expect(typeof call.prompt?.[Symbol.asyncIterator]).toBe('function');
    });

    it('includes image content in streaming prompts when enabled', async () => {
      const modelWithImages = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { streamingInput: 'always' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'img-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      let promptContentPromise: Promise<any> | undefined;

      const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> => {
        return Boolean(
          value &&
          typeof value === 'object' &&
          Symbol.asyncIterator in value &&
          typeof (value as Record<PropertyKey, unknown>)[Symbol.asyncIterator] === 'function'
        );
      };

      vi.mocked(mockQuery).mockImplementation(({ prompt }) => {
        if (isAsyncIterable(prompt)) {
          const iterator = prompt[Symbol.asyncIterator]();
          promptContentPromise = iterator
            .next()
            .then(({ value }) => (value as SDKUserMessage | undefined)?.message?.content);
        }
        return mockResponse as any;
      });

      await modelWithImages.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
            ],
          },
        ],
      } as any);

      expect(promptContentPromise).toBeDefined();
      const content = await promptContentPromise!;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'text', text: 'Human: Describe this image.' });
      expect(content[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aGVsbG8=',
        },
      });
    });

    it('keeps string prompt when streamingInput off even if canUseTool provided', async () => {
      const modelWithOff = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
          streamingInput: 'off',
        } as any,
      });
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's3',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithOff.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(typeof call.prompt).toBe('string');
    });

    it('throws when canUseTool is combined with permissionPromptToolName', async () => {
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
          permissionPromptToolName: 'stdio',
          streamingInput: 'auto',
        } as any,
      });

      const promise = model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      await expect(promise).rejects.toThrow(/cannot be used with permissionPromptToolName/);
    });
    it('should pass through hooks and canUseTool to SDK query options', async () => {
      const preToolHook = async () => ({ continue: true });
      const hooks = { PreToolUse: [{ hooks: [preToolHook] }] } as any;
      const canUseTool = async () => ({ behavior: 'allow', updatedInput: {} });

      const modelWithCallbacks = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { hooks, canUseTool } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's1',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithCallbacks.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      expect(vi.mocked(mockQuery)).toHaveBeenCalled();
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(call?.options?.hooks).toBe(hooks);
      expect(call?.options?.canUseTool).toBe(canUseTool);
    });

    it('should merge base env with settings.env and allow undefined values', async () => {
      const originalMerge = process.env.C2_TEST_MERGE;
      const originalOverride = process.env.C2_TEST_OVERRIDE;
      const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
      try {
        process.env.C2_TEST_MERGE = 'from-process';
        process.env.C2_TEST_OVERRIDE = 'original';
        process.env.CLAUDE_CONFIG_DIR = 'from-process';

        const modelWithEnv = new ClaudeCodeLanguageModel({
          id: 'sonnet',
          settings: {
            env: {
              CUSTOM_ENV: 'custom',
              C2_TEST_OVERRIDE: 'override',
              C2_TEST_UNDEF: undefined,
            },
          } as any,
        });

        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 's-env',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        };
        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        await modelWithEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);

        const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        expect(call).toBeDefined();
        expect(call.options).toBeDefined();
        expect(call.options.env).toBeDefined();
        // Provided vars
        expect(call.options.env.CUSTOM_ENV).toBe('custom');
        expect(call.options.env.C2_TEST_OVERRIDE).toBe('override');
        // Whitelisted from process.env
        expect(call.options.env.CLAUDE_CONFIG_DIR).toBe('from-process');
        expect('C2_TEST_MERGE' in call.options.env).toBe(false);
        // Undefined values are preserved (key exists with undefined)
        expect('C2_TEST_UNDEF' in call.options.env).toBe(true);
        expect(call.options.env.C2_TEST_UNDEF).toBeUndefined();
      } finally {
        if (originalMerge === undefined) {
          delete process.env.C2_TEST_MERGE;
        } else {
          process.env.C2_TEST_MERGE = originalMerge;
        }
        if (originalOverride === undefined) {
          delete process.env.C2_TEST_OVERRIDE;
        } else {
          process.env.C2_TEST_OVERRIDE = originalOverride;
        }
        if (originalClaudeConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
        }
      }
    });

    it('should always pass an allowlisted env to SDK options when settings.env is undefined', async () => {
      const modelNoEnv = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {},
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-noenv',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelNoEnv.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call).toBeDefined();
      expect(call.options).toBeDefined();
      // SDK 0.3.x replaces the subprocess env entirely, so the provider always
      // constructs the env from the sanitizing allowlist.
      expect(call.options.env).toBeDefined();
      if (process.env.PATH !== undefined) {
        expect(call.options.env.PATH).toBe(process.env.PATH);
      }
    });

    it('should inherit prefix-matched env vars (ANTHROPIC_/CLAUDE_/AWS_/GOOGLE_) and exact network vars', async () => {
      const testKeys = [
        'ANTHROPIC_TEST_X',
        'CLAUDE_TEST_X',
        'AWS_TEST_X',
        'GOOGLE_TEST_X',
        'HTTPS_PROXY',
        'NO_PROXY',
        'NODE_EXTRA_CA_CERTS',
        'GCLOUD_PROJECT',
        'CLOUD_ML_REGION',
        'NOT_ALLOWLISTED_TEST_X',
      ] as const;
      const original: Record<string, string | undefined> = {};
      for (const key of testKeys) original[key] = process.env[key];
      try {
        for (const key of testKeys) process.env[key] = `value-${key}`;

        const modelNoEnv = new ClaudeCodeLanguageModel({
          id: 'sonnet',
          settings: {},
        });

        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 's-prefix-env',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        };
        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        await modelNoEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);

        const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        const env = call.options.env;
        expect(env).toBeDefined();
        // Prefix-matched inheritance
        expect(env.ANTHROPIC_TEST_X).toBe('value-ANTHROPIC_TEST_X');
        expect(env.CLAUDE_TEST_X).toBe('value-CLAUDE_TEST_X');
        expect(env.AWS_TEST_X).toBe('value-AWS_TEST_X');
        expect(env.GOOGLE_TEST_X).toBe('value-GOOGLE_TEST_X');
        // Exact-key network/cloud allowlist
        expect(env.HTTPS_PROXY).toBe('value-HTTPS_PROXY');
        expect(env.NO_PROXY).toBe('value-NO_PROXY');
        expect(env.NODE_EXTRA_CA_CERTS).toBe('value-NODE_EXTRA_CA_CERTS');
        expect(env.GCLOUD_PROJECT).toBe('value-GCLOUD_PROJECT');
        expect(env.CLOUD_ML_REGION).toBe('value-CLOUD_ML_REGION');
        // Non-allowlisted vars are not inherited
        expect('NOT_ALLOWLISTED_TEST_X' in env).toBe(false);
      } finally {
        for (const key of testKeys) {
          if (original[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = original[key];
          }
        }
      }
    });

    it('should default CLAUDE_AGENT_SDK_CLIENT_APP and allow overrides', async () => {
      const originalClientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP;
      try {
        delete process.env.CLAUDE_AGENT_SDK_CLIENT_APP;

        const mockResponse = () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 's-client-app',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        });

        // Default applied when not set anywhere
        const modelDefault = new ClaudeCodeLanguageModel({ id: 'sonnet', settings: {} });
        vi.mocked(mockQuery).mockReturnValue(mockResponse() as any);
        await modelDefault.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);
        let call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        // Sync check: the hardcoded PROVIDER_VERSION constant must match
        // package.json so the telemetry identifier never reports a stale version.
        const pkgVersion = JSON.parse(
          readFileSync(new URL('../package.json', import.meta.url), 'utf8')
        ).version as string;
        expect(call.options.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe(
          `ai-sdk-provider-claude-code/${pkgVersion}`
        );

        // settings.env override wins
        vi.mocked(mockQuery).mockClear();
        const modelSettingsEnv = new ClaudeCodeLanguageModel({
          id: 'sonnet',
          settings: { env: { CLAUDE_AGENT_SDK_CLIENT_APP: 'my-app/1.0.0' } } as any,
        });
        vi.mocked(mockQuery).mockReturnValue(mockResponse() as any);
        await modelSettingsEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);
        call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        expect(call.options.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('my-app/1.0.0');

        // process.env value is inherited (CLAUDE_ prefix) and not overwritten
        vi.mocked(mockQuery).mockClear();
        process.env.CLAUDE_AGENT_SDK_CLIENT_APP = 'from-process/2.0.0';
        const modelProcessEnv = new ClaudeCodeLanguageModel({ id: 'sonnet', settings: {} });
        vi.mocked(mockQuery).mockReturnValue(mockResponse() as any);
        await modelProcessEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);
        call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        expect(call.options.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('from-process/2.0.0');
      } finally {
        if (originalClientApp === undefined) {
          delete process.env.CLAUDE_AGENT_SDK_CLIENT_APP;
        } else {
          process.env.CLAUDE_AGENT_SDK_CLIENT_APP = originalClientApp;
        }
      }
    });

    it('should pass settingSources: [] to the SDK when unset (isolation mode)', async () => {
      const modelDefault = new ClaudeCodeLanguageModel({ id: 'sonnet', settings: {} });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sources-default',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelDefault.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call.options.settingSources).toEqual([]);
    });

    it('should pass user-provided settingSources through and allow sdkOptions override', async () => {
      const mockResponse = () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sources-user',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      });

      const modelWithSources = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { settingSources: ['user', 'project'] },
      });
      vi.mocked(mockQuery).mockReturnValue(mockResponse() as any);
      await modelWithSources.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      let call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call.options.settingSources).toEqual(['user', 'project']);

      // sdkOptions escape hatch overrides the pinned default
      vi.mocked(mockQuery).mockClear();
      const modelWithSdkOverride = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { sdkOptions: { settingSources: ['local'] } } as any,
      });
      vi.mocked(mockQuery).mockReturnValue(mockResponse() as any);
      await modelWithSdkOverride.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call.options.settingSources).toEqual(['local']);
    });

    it('should keep the pinned settingSources: [] when sdkOptions has an explicit undefined', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sources-undefined',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      // Conditionally-built sdkOptions can carry undefined-valued own properties;
      // those must not clobber the isolation default (SDK 0.3.x treats an
      // undefined settingSources as "load ALL filesystem settings").
      const modelWithUndefinedOverride = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { sdkOptions: { settingSources: undefined } } as any,
      });
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);
      await modelWithUndefinedOverride.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call.options.settingSources).toEqual([]);
    });

    it('should pass through Agent SDK options and allow sdkOptions overrides', async () => {
      const modelWithSdkOptions = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          maxTurns: 5,
          betas: ['context-1m-2025-08-07'],
          enableFileCheckpointing: true,
          maxBudgetUsd: 2,
          plugins: [{ type: 'local', path: './plugins/example' }],
          resumeSessionAt: 'message-uuid',
          sandbox: { enabled: true },
          tools: ['Read'],
          sdkOptions: {
            maxTurns: 9,
            allowDangerouslySkipPermissions: true,
          },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sdk',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSdkOptions.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.maxTurns).toBe(9);
      expect(call?.options?.betas).toEqual(['context-1m-2025-08-07']);
      expect(call?.options?.enableFileCheckpointing).toBe(true);
      expect(call?.options?.maxBudgetUsd).toBe(2);
      expect(call?.options?.plugins).toEqual([{ type: 'local', path: './plugins/example' }]);
      expect(call?.options?.resumeSessionAt).toBe('message-uuid');
      expect(call?.options?.sandbox).toEqual({ enabled: true });
      expect(call?.options?.tools).toEqual(['Read']);
      expect(call?.options?.allowDangerouslySkipPermissions).toBe(true);
    });

    it('should pass through persistSession option', async () => {
      const modelWithPersist = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          persistSession: false,
        },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-persist',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithPersist.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.persistSession).toBe(false);
    });

    it('should pass through new SDK 0.3.x options', async () => {
      const modelWithNewOptions = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          skills: ['pdf', 'docx'],
          settings: { permissions: { allow: ['Bash(ls:*)'] } },
          managedSettings: { sandbox: { network: { allowManagedDomainsOnly: true } } },
          toolAliases: { Bash: 'mcp__workspace__bash' },
          toolConfig: { askUserQuestion: { previewFormat: 'html' } },
          planModeInstructions: 'Research only; produce a migration plan.',
          title: 'My custom session',
          forwardSubagentText: true,
          agentProgressSummaries: true,
          includeHookEvents: true,
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-new-options',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithNewOptions.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.skills).toEqual(['pdf', 'docx']);
      expect(call?.options?.settings).toEqual({ permissions: { allow: ['Bash(ls:*)'] } });
      expect(call?.options?.managedSettings).toEqual({
        sandbox: { network: { allowManagedDomainsOnly: true } },
      });
      expect(call?.options?.toolAliases).toEqual({ Bash: 'mcp__workspace__bash' });
      expect(call?.options?.toolConfig).toEqual({ askUserQuestion: { previewFormat: 'html' } });
      expect(call?.options?.planModeInstructions).toBe('Research only; produce a migration plan.');
      expect(call?.options?.title).toBe('My custom session');
      expect(call?.options?.forwardSubagentText).toBe(true);
      expect(call?.options?.agentProgressSummaries).toBe(true);
      expect(call?.options?.includeHookEvents).toBe(true);
    });

    it('should pass through onUserDialog and supportedDialogKinds', async () => {
      const onUserDialog = vi.fn(async () => ({ behavior: 'cancelled' as const }));
      const modelWithDialogs = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          onUserDialog,
          supportedDialogKinds: ['refusal_fallback_prompt'],
        },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-dialogs',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithDialogs.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.onUserDialog).toBe(onUserDialog);
      expect(call?.options?.supportedDialogKinds).toEqual(['refusal_fallback_prompt']);
    });

    it('should omit onUserDialog and supportedDialogKinds when unset', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-no-dialogs',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect('onUserDialog' in call.options).toBe(false);
      expect('supportedDialogKinds' in call.options).toBe(false);
    });

    it("should pass through skills: 'all'", async () => {
      const modelWithSkills = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { skills: 'all' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-skills-all',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSkills.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.skills).toBe('all');
    });

    it("should accept effort 'xhigh' and pass it through", async () => {
      const modelWithEffort = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { effort: 'xhigh' },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-effort',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithEffort.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.effort).toBe('xhigh');
    });

    it('should pass through systemPrompt as an array of blocks', async () => {
      const systemPrompt = [
        'Static instructions.',
        '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__',
        'Session-specific context.',
      ];
      const modelWithArrayPrompt = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { systemPrompt } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sysprompt-array',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithArrayPrompt.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.systemPrompt).toEqual(systemPrompt);
    });

    it('should pass through systemPrompt preset with excludeDynamicSections', async () => {
      const modelWithPreset = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            excludeDynamicSections: true,
          },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-sysprompt-preset',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithPreset.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.systemPrompt).toEqual({
        type: 'preset',
        preset: 'claude_code',
        excludeDynamicSections: true,
      });
    });

    it('should pass through alpha options (taskBudget, sessionStore, sessionStoreFlush, loadTimeoutMs)', async () => {
      const sessionStore = {
        append: async () => undefined,
        load: async () => null,
      };
      const modelWithAlphaOptions = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          taskBudget: { total: 50000 },
          sessionStore,
          sessionStoreFlush: 'eager',
          loadTimeoutMs: 30000,
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-alpha',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithAlphaOptions.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.taskBudget).toEqual({ total: 50000 });
      expect(call?.options?.sessionStore).toBe(sessionStore);
      expect(call?.options?.sessionStoreFlush).toBe('eager');
      expect(call?.options?.loadTimeoutMs).toBe(30000);
    });

    it('should pass through sessionId option', async () => {
      const modelWithSessionId = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: 'custom-session-123',
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'custom-session-123',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSessionId.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.sessionId).toBe('custom-session-123');
    });

    it('should stop forwarding sessionId once a resume target exists (CLI rejects --session-id with --resume)', async () => {
      const customSessionId = '4ed1ad15-2d5e-4e0c-92cb-e4ae42049fb6';
      const modelWithSessionId = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: customSessionId,
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: customSessionId,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const doGenerateOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any;

      // Turn 1: no resume target yet, sessionId is forwarded.
      await modelWithSessionId.doGenerate(doGenerateOptions);
      const firstCall = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(firstCall?.options?.sessionId).toBe(customSessionId);
      expect(firstCall?.options?.resume).toBeUndefined();

      // Turn 2: the provider auto-resumes via the captured session ID (which
      // already IS the custom ID); forwarding sessionId again would send the
      // CLI-forbidden --resume + --session-id combination.
      await modelWithSessionId.doGenerate(doGenerateOptions);
      const secondCall = vi.mocked(mockQuery).mock.calls[1]?.[0] as any;
      expect(secondCall?.options?.resume).toBe(customSessionId);
      expect(secondCall?.options?.sessionId).toBeUndefined();
    });

    it('should keep forwarding sessionId alongside resume when forkSession is set', async () => {
      const forkId = '9bd1ad15-2d5e-4e0c-92cb-e4ae42049fb7';
      const modelWithFork = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: forkId,
          resume: 'original-session',
          forkSession: true,
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: forkId,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithFork.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.resume).toBe('original-session');
      expect(call?.options?.sessionId).toBe(forkId);
      expect(call?.options?.forkSession).toBe(true);
    });

    it('should honor forkSession from the sdkOptions escape hatch when forwarding sessionId', async () => {
      const forkId = '4f3a2b1c-8d7e-4f6a-9b0c-1d2e3f4a5b6c';
      const modelWithSdkFork = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: forkId,
          resume: 'original-session',
          sdkOptions: { forkSession: true },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: forkId,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSdkFork.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.resume).toBe('original-session');
      expect(call?.options?.sessionId).toBe(forkId);
      expect(call?.options?.forkSession).toBe(true);
    });

    it('should drop sessionId when continue arrives via the sdkOptions escape hatch without forkSession', async () => {
      const modelWithSdkContinue = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          sdkOptions: { continue: true },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'continued-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSdkContinue.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      // --session-id --continue is an invalid CLI invocation without
      // --fork-session; sessionId must be suppressed.
      expect(call?.options?.continue).toBe(true);
      expect(call?.options?.sessionId).toBeUndefined();
    });

    it('should forward sessionId with sdkOptions.continue when forkSession is also set', async () => {
      const forkId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
      const modelWithContinueFork = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: forkId,
          sdkOptions: { continue: true, forkSession: true },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: forkId,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithContinueFork.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.continue).toBe(true);
      expect(call?.options?.forkSession).toBe(true);
      expect(call?.options?.sessionId).toBe(forkId);
    });

    it('should let sdkOptions.forkSession: false override settings.forkSession for the sessionId decision', async () => {
      const modelWithForkDisabled = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          resume: 'original-session',
          forkSession: true,
          sdkOptions: { forkSession: false },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'original-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithForkDisabled.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.resume).toBe('original-session');
      // Fork disabled via escape hatch -> sessionId must be dropped to avoid
      // the CLI's --session-id/--resume conflict.
      expect(call?.options?.sessionId).toBeUndefined();
      expect(call?.options?.forkSession).toBe(false);
    });

    it('should reject fallbackModel equal to the main model before invoking the SDK', async () => {
      const modelWithSameFallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          fallbackModel: 'sonnet',
        } as any,
      });

      await expect(
        modelWithSameFallback.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any)
      ).rejects.toThrow(/fallbackModel cannot be the same as the model/);
      expect(vi.mocked(mockQuery)).not.toHaveBeenCalled();

      // A different fallbackModel passes through untouched.
      const modelWithFallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          fallbackModel: 'haiku',
        } as any,
      });
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-fallback',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);
      await modelWithFallback.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.fallbackModel).toBe('haiku');
    });

    it('should pass through debug and debugFile options', async () => {
      const modelWithDebug = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          debug: true,
          debugFile: '/tmp/debug.log',
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-debug',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithDebug.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.debug).toBe(true);
      expect(call?.options?.debugFile).toBe('/tmp/debug.log');
    });

    it('should use stop_reason from result message for finish reason', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-stop-reason',
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: 'end_turn',
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      expect(result.finishReason).toEqual({ unified: 'stop', raw: 'end_turn' });
    });

    it('should pass through spawnClaudeCodeProcess option', async () => {
      const customSpawner = vi.fn();
      const modelWithSpawner = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          spawnClaudeCodeProcess: customSpawner,
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-spawn',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithSpawner.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.spawnClaudeCodeProcess).toBe(customSpawner);
    });

    it('should sync sdkOptions.resume with streaming prompt session_id', async () => {
      const modelWithResume = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          resume: 'settings-session',
          sdkOptions: { resume: 'sdk-session' },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'sdk-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      let promptSessionId: string | undefined;
      let promptSessionPromise: Promise<void> | undefined;
      vi.mocked(mockQuery).mockImplementation(({ prompt }) => {
        const iterator =
          prompt && typeof (prompt as any)[Symbol.asyncIterator] === 'function'
            ? (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]()
            : undefined;
        if (iterator) {
          promptSessionPromise = iterator.next().then(({ value }) => {
            promptSessionId = value?.session_id;
          });
        }
        return mockResponse as any;
      });

      await modelWithResume.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      if (promptSessionPromise) {
        await promptSessionPromise;
      }

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.resume).toBe('sdk-session');
      expect(promptSessionId).toBe('sdk-session');
    });

    it('should ignore blocked sdkOptions fields', async () => {
      const externalAbortController = new AbortController();
      const modelWithBlocked = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sdkOptions: {
            model: 'override-model',
            abortController: externalAbortController,
            prompt: 'override-prompt',
            outputFormat: { type: 'json_schema', schema: { foo: 'bar' } },
          },
        } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-blocked',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithBlocked.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call?.options?.model).not.toBe('override-model');
      expect(call?.options?.abortController).not.toBe(externalAbortController);
    });

    it('should merge base env with settings and sdkOptions env', async () => {
      const originalProcessEnv = { ...process.env };
      try {
        process.env.C2_ENV_PROCESS = 'from-process';
        process.env.C2_ENV_OVERRIDE = 'process';
        process.env.CLAUDE_CONFIG_DIR = 'from-process';

        const modelWithEnv = new ClaudeCodeLanguageModel({
          id: 'sonnet',
          settings: {
            env: {
              C2_ENV_SETTINGS: 'from-settings',
              C2_ENV_OVERRIDE: 'settings',
            },
            sdkOptions: {
              env: {
                C2_ENV_SDK: 'from-sdk',
                C2_ENV_OVERRIDE: 'sdk',
              },
            },
          } as any,
        });

        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 's-env-merge',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        };
        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        await modelWithEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);

        const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        expect(call?.options?.env?.CLAUDE_CONFIG_DIR).toBe('from-process');
        expect(call?.options?.env?.C2_ENV_SETTINGS).toBe('from-settings');
        expect(call?.options?.env?.C2_ENV_SDK).toBe('from-sdk');
        expect(call?.options?.env?.C2_ENV_OVERRIDE).toBe('sdk');
        expect(call?.options?.env?.C2_ENV_PROCESS).toBeUndefined();
      } finally {
        process.env = originalProcessEnv;
      }
    });

    it('should preserve stderr collector when sdkOptions.stderr is set', async () => {
      const sdkStderr = vi.fn();
      const modelWithStderr = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          sdkOptions: {
            stderr: sdkStderr,
          },
        } as any,
      });

      vi.mocked(mockQuery).mockImplementation(({ options }: any) => {
        if (options?.stderr) {
          options.stderr('Error: Not authenticated\n');
          options.stderr('Please run: claude login\n');
        }
        const error = new Error('Failed with exit code: 1');
        (error as any).exitCode = 1;
        throw error;
      });

      let thrownError: unknown;
      try {
        await modelWithStderr.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);
      } catch (error) {
        thrownError = error;
      }

      expect(sdkStderr).toHaveBeenCalledWith('Error: Not authenticated\n');
      expect(sdkStderr).toHaveBeenCalledWith('Please run: claude login\n');
      const metadata = getErrorMetadata(thrownError);
      expect(metadata?.stderr).toBe('Error: Not authenticated\nPlease run: claude login\n');
      expect(metadata?.exitCode).toBe(1);
    });
    it('should generate text from SDK response', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
          };
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Hello, ' },
                { type: 'text', text: 'world!' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      expect(result.content).toEqual([{ type: 'text', text: 'Hello, world!' }]);
      expect(result.usage.inputTokens.total).toBe(10);
      expect(result.usage.outputTokens.total).toBe(5);
      expect(result.finishReason.unified).toBe('stop');
    });

    it('should log actionable MCP warnings for failed and needs-auth servers on init', async () => {
      const warn = vi.fn();
      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
            mcp_servers: [
              { name: 'filesystem', status: 'failed', error: 'connection refused' },
              { name: 'exa', status: 'needs-auth' },
              { name: 'ok', status: 'connected' },
            ],
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'hello' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithLogger.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      expect(warn).toHaveBeenCalledTimes(1);
      const warning = warn.mock.calls[0]?.[0] as string;
      expect(warning).toContain('filesystem:failed (connection refused)');
      expect(warning).toContain('exa:needs-auth');
      expect(warning).not.toContain('[object Object]');
    });

    it('should not warn for pending or disabled MCP servers on init', async () => {
      const warn = vi.fn();
      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
            mcp_servers: [
              { name: 'filesystem', status: 'pending' },
              { name: 'exa', status: 'disabled' },
              { name: 'ok', status: 'connected' },
            ],
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithLogger.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it('should handle error_max_turns as length finish reason', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Partial response' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'error_max_turns',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Complex task' }] }],
      });

      expect(result.finishReason.unified).toBe('length');
    });

    it('should handle AbortError correctly', async () => {
      const abortController = new AbortController();
      const abortReason = new Error('User cancelled');

      // Set up the mock to throw AbortError when called
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new MockAbortError('Operation aborted');
      });

      // Abort before calling to ensure signal.aborted is true
      abortController.abort(abortReason);

      const promise = model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test abort' }] }],
        abortSignal: abortController.signal,
      });

      // Should throw the abort reason since signal is aborted
      await expect(promise).rejects.toThrow(abortReason);
    });

    it('should capture stderr from callback when SDK throws error', async () => {
      const stderrMessages: string[] = [];
      const stderrCallback = vi.fn((data: string) => {
        stderrMessages.push(data);
      });

      const modelWithStderr = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { stderr: stderrCallback },
      });

      // Mock query to call stderr callback then throw an error
      vi.mocked(mockQuery).mockImplementation(({ options }: any) => {
        // Simulate stderr output before error (e.g., auth failure message)
        if (options?.stderr) {
          options.stderr('Error: Not authenticated\n');
          options.stderr('Please run: claude login\n');
        }

        // Throw an error with exitCode (like auth failure)
        const error = new Error('Failed with exit code: 1');
        (error as any).exitCode = 1;
        throw error;
      });

      let thrownError: unknown;
      try {
        await modelWithStderr.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      // Verify user's stderr callback was still called
      expect(stderrCallback).toHaveBeenCalledWith('Error: Not authenticated\n');
      expect(stderrCallback).toHaveBeenCalledWith('Please run: claude login\n');

      // Verify the error contains the stderr data
      expect(thrownError).toBeDefined();
      const metadata = getErrorMetadata(thrownError);
      expect(metadata).toBeDefined();
      expect(metadata?.stderr).toBe('Error: Not authenticated\nPlease run: claude login\n');
      expect(metadata?.exitCode).toBe(1);
    });

    it('should detect /login pattern as authentication error', async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('Please run /login to authenticate');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(isAuthenticationError(thrownError)).toBe(true);
    });

    it('should detect invalid api key pattern as authentication error', async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('Invalid API key provided');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(isAuthenticationError(thrownError)).toBe(true);
    });

    it('should detect oauth_org_not_allowed pattern as authentication error', async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('Request failed: oauth_org_not_allowed');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(isAuthenticationError(thrownError)).toBe(true);
    });

    it('should map overloaded errors to a retryable APICallError', async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('API error: overloaded');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(APICallError);
      expect((thrownError as APICallError).isRetryable).toBe(true);
      expect((thrownError as APICallError).message).toContain('overloaded');
    });

    it('should map model_not_found errors to a non-retryable APICallError', async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('API error: model_not_found');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(APICallError);
      expect((thrownError as APICallError).isRetryable).toBe(false);
      expect((thrownError as APICallError).message).toContain('model was not found');
    });

    it("should map 'no such model' errors to a non-retryable APICallError", async () => {
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new Error('No such model: claude-nonexistent');
      });

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(APICallError);
      expect((thrownError as APICallError).isRetryable).toBe(false);
      expect((thrownError as APICallError).message).toContain('model was not found');
    });

    // SDK 0.3.x delivers error kinds structurally: SDKAssistantMessage.error
    // carries the kind, and SDKResultError has `errors: string[]` (no `result`
    // field). These tests exercise that delivery path end to end.
    const structuredErrorResponse = (kind: string, errors: string[]) => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          error: kind,
          message: { type: 'message', role: 'assistant', content: [] },
          session_id: 'structured-error-session',
        };
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors,
          session_id: 'structured-error-session',
          total_cost_usd: 0,
          duration_ms: 10,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      },
    });

    it('should classify structured overloaded result errors as retryable', async () => {
      vi.mocked(mockQuery).mockReturnValue(
        structuredErrorResponse('overloaded', ['API request failed']) as any
      );

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(APICallError);
      expect((thrownError as APICallError).isRetryable).toBe(true);
      // SDKResultError detail comes from errors[], not the missing result field
      expect((thrownError as APICallError).message).toContain('API request failed');
    });

    it('should classify structured model_not_found result errors as non-retryable', async () => {
      vi.mocked(mockQuery).mockReturnValue(
        structuredErrorResponse('model_not_found', ['Request failed with status 404']) as any
      );

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(APICallError);
      expect((thrownError as APICallError).isRetryable).toBe(false);
      expect((thrownError as APICallError).message).toContain('model was not found');
    });

    it('should classify structured oauth_org_not_allowed result errors as authentication errors', async () => {
      vi.mocked(mockQuery).mockReturnValue(
        structuredErrorResponse('oauth_org_not_allowed', ['Request failed with status 403']) as any
      );

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(isAuthenticationError(thrownError)).toBe(true);
    });

    it('should emit a retryable error chunk for structured overloaded errors in streaming', async () => {
      vi.mocked(mockQuery).mockReturnValue(
        structuredErrorResponse('overloaded', ['API request failed']) as any
      );

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: ExtendedStreamPart[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const errorChunk = chunks.find((chunk) => chunk.type === 'error') as
        | { type: 'error'; error: unknown }
        | undefined;
      expect(errorChunk).toBeDefined();
      expect(errorChunk!.error).toBeInstanceOf(APICallError);
      expect((errorChunk!.error as APICallError).isRetryable).toBe(true);
      expect((errorChunk!.error as APICallError).message).toContain('API request failed');
    });

    it('should throw error when result message has is_error flag', async () => {
      // This simulates the actual CLI response when unauthenticated
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success', // CLI returns success subtype even on error
            is_error: true,
            result: 'Invalid API key · Please run /login',
            session_id: 'test-session',
            total_cost_usd: 0,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(Error);
      // The error message should contain the original error content
      expect((thrownError as Error).message).toContain('Invalid API key');
      // The error should be converted to an auth error (contains /login pattern)
      expect(isAuthenticationError(thrownError)).toBe(true);
    });

    it('should use default message when is_error is true but result field is missing', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            is_error: true,
            // No result field
            session_id: 'test-session',
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      let thrownError: unknown;
      try {
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toBe('Claude Code CLI returned an error');
    });

    it('should include stderr in error metadata when is_error is true', async () => {
      const stderrCallback = vi.fn();
      const modelWithStderr = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { stderr: stderrCallback },
      });

      vi.mocked(mockQuery).mockImplementation(({ options }: any) => {
        // Simulate stderr being emitted before the is_error result
        if (options?.stderr) {
          options.stderr('Warning: some diagnostic info\n');
        }
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              is_error: true,
              result: 'Some error occurred',
              session_id: 'test-session',
            };
          },
        } as any;
      });

      let thrownError: unknown;
      try {
        await modelWithStderr.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });
      } catch (e) {
        thrownError = e;
      }

      // Verify stderr callback was invoked
      expect(stderrCallback).toHaveBeenCalledWith('Warning: some diagnostic info\n');

      // Verify error was thrown
      expect(thrownError).toBeDefined();
      expect((thrownError as Error).message).toBe('Some error occurred');

      // Verify error metadata includes collected stderr
      const metadata = getErrorMetadata(thrownError);
      expect(metadata?.stderr).toBe('Warning: some diagnostic info\n');
    });

    it('recovers from CLI truncation errors and returns buffered text', async () => {
      const repeatedTasks = Array.from({ length: 400 }, (_, i) => `task-${i}`).join('","');
      const partialResponse = `{"tasks": ["${repeatedTasks}`;
      const truncationPosition = partialResponse.length;
      const truncationError = new SyntaxError(
        `Unexpected end of JSON input at position ${truncationPosition} (line 1 column ${
          truncationPosition + 1
        })`
      );

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw truncationError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
        responseFormat: { type: 'json' },
      } as any);

      expect(result.finishReason.unified).toBe('length');
      const hasTruncationWarning = result.warnings.some(
        (warning) =>
          'message' in warning &&
          typeof warning.message === 'string' &&
          warning.message.includes('output ended unexpectedly')
      );
      expect(hasTruncationWarning).toBe(true);
      expect(result.providerMetadata?.['claude-code']?.truncated).toBe(true);
      expect(result.content[0]).toEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('task-10'),
        })
      );
    });

    it('propagates JSON syntax errors without marking truncation', async () => {
      const partialResponse = '{"tasks": ["task-1"}';
      const parseError = new SyntaxError('Unexpected token } in JSON at position 18');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await expect(
        model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
          responseFormat: { type: 'json' },
        } as any)
      ).rejects.toThrow(/Unexpected token \}/);
    });

    it('propagates short unexpected end errors without treating as truncation', async () => {
      const partialResponse = '{"tasks": "';
      const parseError = new SyntaxError('Unexpected end of JSON input');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await expect(
        model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
          responseFormat: { type: 'json' },
        } as any)
      ).rejects.toThrow(/Unexpected end of JSON input/);
    });

    it('should include modelUsage in providerMetadata when available', async () => {
      const mockModelUsage = {
        'claude-sonnet-4-20250514': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 10,
          webSearchRequests: 0,
          costUSD: 0.001,
          contextWindow: 200000,
          maxOutputTokens: 16384,
        },
      };

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'model-usage-session',
            usage: { input_tokens: 100, output_tokens: 50 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            modelUsage: mockModelUsage,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      expect(result.providerMetadata?.['claude-code']?.modelUsage).toEqual(mockModelUsage);
    });

    it('should not include modelUsage in providerMetadata when not available', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'no-model-usage-session',
            usage: { input_tokens: 100, output_tokens: 50 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            // No modelUsage field
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      expect(result.providerMetadata?.['claude-code']?.modelUsage).toBeUndefined();
    });

    it('extracts thinking blocks as reasoning content parts', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'thinking', thinking: 'Let me reason about this...' },
                { type: 'text', text: 'Here is the answer.' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'thinking-session',
            usage: { input_tokens: 50, output_tokens: 30 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Think about this' }] }],
      } as any);

      if (result.content.length < 2) {
        throw new Error(`expected at least 2 content parts, got ${result.content.length}`);
      }
      expect(result.content[0]).toEqual({ type: 'reasoning', text: 'Let me reason about this...' });
      expect(result.content[1]).toEqual({ type: 'text', text: 'Here is the answer.' });
      expect(result.providerMetadata?.['claude-code']?.thinkingTraces).toEqual([
        'Let me reason about this...',
      ]);
    });

    it('returns only text part when no thinking blocks present', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Just text, no thinking.' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'no-thinking-session',
            usage: { input_tokens: 10, output_tokens: 10 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Just text, no thinking.' });
      expect(result.providerMetadata?.['claude-code']?.thinkingTraces).toBeUndefined();
    });
  });

  describe('doStream', () => {
    it('invokes onQueryCreated with the query response', async () => {
      const onQueryCreated = vi.fn();
      const modelWithHook = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onQueryCreated } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hello' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'stream-query',
            usage: { input_tokens: 1, output_tokens: 1 },
            total_cost_usd: 0.001,
            duration_ms: 50,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await modelWithHook.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(onQueryCreated).toHaveBeenCalledTimes(1);
      expect(onQueryCreated).toHaveBeenCalledWith(mockResponse);
    });

    it('should log actionable MCP warnings on stream init for failed servers', async () => {
      const warn = vi.fn();
      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'stream-session-1',
            mcp_servers: [{ name: 'filesystem', status: 'failed', error: 'spawn failed' }],
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'stream-session-1',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await modelWithLogger.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });

      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('filesystem:failed (spawn failed)');
    });

    it('should stream text chunks from SDK response', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello' }],
            },
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: ', world!' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(6);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
        warnings: [],
      });
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: 'Hello',
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-delta',
        delta: ', world!',
      });
      expect(chunks[4]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[5]).toMatchObject({
        type: 'finish',
        finishReason: { unified: 'stop' },
        usage: {
          inputTokens: { total: 10 },
          outputTokens: { total: 5 },
        },
      });
    });

    it('should emit error chunk when result message has is_error flag in streaming', async () => {
      // This simulates the actual CLI response when unauthenticated during streaming
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success', // CLI returns success subtype even on error
            is_error: true,
            result: 'Invalid API key · Please run /login',
            session_id: 'test-session',
            total_cost_usd: 0,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: ExtendedStreamPart[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should emit stream-start and then error
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
      });
      expect(chunks[1]).toMatchObject({
        type: 'error',
      });
      // The error should contain the auth message
      expect((chunks[1] as any).error.message).toContain('Invalid API key');
      // The error should be converted to an auth error (contains /login pattern)
      expect(isAuthenticationError((chunks[1] as any).error)).toBe(true);
    });

    it('should use stop_reason from result message for stream finish reason', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-stream-stop',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            stop_reason: 'max_tokens',
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });

      const chunks: ExtendedStreamPart[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishEvent = chunks.find((c) => c.type === 'finish');
      expect(finishEvent).toBeDefined();
      expect((finishEvent as any).finishReason).toEqual({
        unified: 'length',
        raw: 'max_tokens',
      });
    });

    describe('stream_event handling (includePartialMessages)', () => {
      // Helper to create stream_event messages with text_delta
      const createTextDeltaEvent = (text: string, index = 0) => ({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text },
        },
      });

      // Helper to create a result message
      const createResultMessage = (sessionId = 'test-session') => ({
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001,
        duration_ms: 1000,
      });

      it('streams text via stream_event deltas', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield createTextDeltaEvent('Hello');
            yield createTextDeltaEvent(' world');
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        expect(chunks).toHaveLength(6);
        expect(chunks[0]).toMatchObject({ type: 'stream-start' });
        expect(chunks[1]).toMatchObject({ type: 'text-start' });
        expect(chunks[2]).toMatchObject({ type: 'text-delta', delta: 'Hello' });
        expect(chunks[3]).toMatchObject({ type: 'text-delta', delta: ' world' });
        expect(chunks[4]).toMatchObject({ type: 'text-end' });
        expect(chunks[5]).toMatchObject({ type: 'finish', finishReason: { unified: 'stop' } });
      });

      it('deduplicates text when assistant messages follow stream_events', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Stream events deliver text token-by-token
            yield createTextDeltaEvent('Hello');
            yield createTextDeltaEvent(' world');
            // Assistant message arrives with cumulative text (same content)
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: 'Hello world' }] },
            };
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should NOT have duplicate text from assistant message
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(2);
        expect(textDeltas[0].delta).toBe('Hello');
        expect(textDeltas[1].delta).toBe(' world');
      });

      it('emits new text from assistant message that extends beyond streamed content', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Stream event delivers partial text
            yield createTextDeltaEvent('Hello');
            // Assistant message has more text than was streamed
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: 'Hello world!' }] },
            };
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should have 'Hello' from stream_event and ' world!' from assistant message
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(2);
        expect(textDeltas[0].delta).toBe('Hello');
        expect(textDeltas[1].delta).toBe(' world!');
      });

      it('accumulates text without streaming in JSON mode', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield createTextDeltaEvent('{"key":');
            yield createTextDeltaEvent('"value"}');
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
          responseFormat: { type: 'json' },
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // In JSON mode, text should be accumulated and emitted at the end
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(1);
        expect(textDeltas[0].delta).toBe('{"key":"value"}');
      });

      it('falls back to assistant message streaming when no stream_events received', async () => {
        // This tests the original behavior when includePartialMessages doesn't produce stream_events
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: 'Hello' }] },
            };
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: ', world!' }] },
            };
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(2);
        expect(textDeltas[0].delta).toBe('Hello');
        expect(textDeltas[1].delta).toBe(', world!');
      });

      it('ignores non-text_delta stream_events', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // content_block_start should be ignored
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            };
            // text_delta should be processed
            yield createTextDeltaEvent('Hi');
            // content_block_stop should be ignored
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            // message_delta should be ignored
            yield {
              type: 'stream_event',
              event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            };
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Only one text-delta from the text_delta event
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(1);
        expect(textDeltas[0].delta).toBe('Hi');
      });

      it('preserves tool input when tool block stop follows assistant tool_use', async () => {
        const toolUseId = 'toolu_race';
        const toolName = 'RaceTool';
        const toolInput = { plan: 'do stuff', steps: ['a', 'b'] };

        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: toolUseId, name: toolName },
              },
            };
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: toolUseId,
                    name: toolName,
                    input: toolInput,
                  },
                ],
              },
            };
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            yield createResultMessage('tool-race-session');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run tool' }] }],
        });

        const events: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }

        const toolInputDelta = events.find((event) => event.type === 'tool-input-delta') as any;
        const toolCall = events.find((event) => event.type === 'tool-call') as any;

        expect(toolInputDelta?.delta).toBe(JSON.stringify(toolInput));
        expect(toolCall?.input).toBe(JSON.stringify(toolInput));
        expect(toolCall?.providerMetadata?.['claude-code']?.rawInput).toBe(
          JSON.stringify(toolInput)
        );
      });

      it('does not emit duplicate text-end when user message arrives mid-block', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            };
            yield createTextDeltaEvent('Hello', 0);
            yield {
              type: 'user',
              message: {
                content: [],
              },
            };
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            yield createResultMessage('mid-block-user');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textEnds).toHaveLength(1);
      });

      it('does not emit duplicate text-end when tool content_block_start arrives mid-text-block', async () => {
        const toolUseId = 'toolu_mid_text';
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Start a text content block
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            };
            yield createTextDeltaEvent('Hello', 0);
            // Tool content block starts before text block stops
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 1,
                content_block: { type: 'tool_use', id: toolUseId, name: 'TestTool' },
              },
            };
            // Text block stops (should not emit a second text-end)
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 1 },
            };
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: toolUseId, name: 'TestTool', input: {} }],
              },
            };
            yield createResultMessage('tool-mid-text');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textEnds).toHaveLength(1);
      });

      it('does not emit duplicate text-end when assistant message with tools arrives mid-text-block', async () => {
        const toolUseId = 'toolu_asst_mid';
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Start a text content block
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            };
            yield createTextDeltaEvent('Hello', 0);
            // Assistant message with tool arrives before text block stops
            yield {
              type: 'assistant',
              message: {
                content: [
                  { type: 'text', text: 'Hello' },
                  { type: 'tool_use', id: toolUseId, name: 'TestTool', input: {} },
                ],
              },
            };
            // Text block stops (should not emit a second text-end)
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            yield createResultMessage('asst-mid-text');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textEnds).toHaveLength(1);
      });

      it('does not emit duplicate text-end when reasoning content_block_start arrives mid-text-block', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Start a text content block
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            };
            yield createTextDeltaEvent('Hello', 0);
            // Reasoning block starts before text block stops
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 1,
                content_block: { type: 'thinking', thinking: '' },
              },
            };
            // Text block stops (should not emit a second text-end)
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 0 },
            };
            yield {
              type: 'stream_event',
              event: { type: 'content_block_stop', index: 1 },
            };
            yield createResultMessage('reasoning-mid-text');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textEnds).toHaveLength(1);
      });

      it('recovers from truncation when streaming via stream_events', async () => {
        // Generate enough text to exceed MIN_TRUNCATION_LENGTH (512 chars)
        const longText = 'A'.repeat(600);
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Stream text via stream_events
            yield createTextDeltaEvent(longText);
            // Simulate truncation error before assistant message arrives
            throw new SyntaxError('Unexpected end of JSON input');
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate text' }] }],
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should have recovered with truncated text
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas.length).toBeGreaterThan(0);
        expect(textDeltas[0].delta).toBe(longText);

        // Should have finish event with truncated metadata
        const finishEvent = chunks.find((c) => c.type === 'finish');
        expect(finishEvent).toBeDefined();
        expect(finishEvent.finishReason.unified).toBe('length'); // Truncation uses 'length' finish reason
        expect(finishEvent.providerMetadata?.['claude-code']?.truncated).toBe(true);
      });

      // Helper to create stream_event messages with input_json_delta (structured output)
      const createJsonDeltaEvent = (partialJson: string, index = 0) => ({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: partialJson },
        },
      });

      it('streams JSON via input_json_delta events in JSON mode', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield createJsonDeltaEvent('{"name":');
            yield createJsonDeltaEvent('"Alice"');
            yield createJsonDeltaEvent(',"age":');
            yield createJsonDeltaEvent('30}');
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'json-stream-session',
              structured_output: { name: 'Alice', age: 30 },
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
          responseFormat: { type: 'json', schema: { type: 'object' } },
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should have streamed JSON deltas (not accumulated into one chunk)
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas.length).toBe(4);
        expect(textDeltas[0].delta).toBe('{"name":');
        expect(textDeltas[1].delta).toBe('"Alice"');
        expect(textDeltas[2].delta).toBe(',"age":');
        expect(textDeltas[3].delta).toBe('30}');
      });

      it('ignores input_json_delta events in non-JSON mode', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // Text delta should be emitted
            yield createTextDeltaEvent('Hello');
            // JSON delta should be ignored in non-JSON mode (it is tool input)
            yield createJsonDeltaEvent('{"key":"value"}');
            yield createResultMessage();
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
          // No responseFormat - plain text mode
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should only have 'Hello' text delta, not the JSON delta
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(1);
        expect(textDeltas[0].delta).toBe('Hello');
      });

      it('skips empty input_json_delta events', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield createJsonDeltaEvent(''); // Empty delta (common at start)
            yield createJsonDeltaEvent('{"key":');
            yield createJsonDeltaEvent(''); // Another empty
            yield createJsonDeltaEvent('"value"}');
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'json-empty-session',
              structured_output: { key: 'value' },
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
          responseFormat: { type: 'json', schema: { type: 'object' } },
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should only have non-empty JSON deltas
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(2);
        expect(textDeltas[0].delta).toBe('{"key":');
        expect(textDeltas[1].delta).toBe('"value"}');
      });

      it('does not double-emit JSON when structured_output arrives after streaming', async () => {
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // JSON deltas stream the content
            yield createJsonDeltaEvent('{"name":"Bob"}');
            // Result arrives with structured_output (same content)
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'no-double-session',
              structured_output: { name: 'Bob' },
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
          responseFormat: { type: 'json', schema: { type: 'object' } },
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should NOT have duplicate JSON - only the streamed delta
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        expect(textDeltas).toHaveLength(1);
        expect(textDeltas[0].delta).toBe('{"name":"Bob"}');

        // Should have proper text lifecycle (start, delta, end)
        const textStarts = chunks.filter((c) => c.type === 'text-start');
        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textStarts).toHaveLength(1);
        expect(textEnds).toHaveLength(1);
      });

      it('does not double-emit JSON when tool calls follow JSON streaming', async () => {
        const toolUseId = 'toolu_json_1';
        const toolName = 'noop';
        const toolInput = { ok: true };
        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            // JSON deltas stream the content
            yield createJsonDeltaEvent('{"name":"Bob"}');
            // Assistant emits a tool call after JSON streaming
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: toolUseId,
                    name: toolName,
                    input: toolInput,
                  },
                ],
              },
            };
            // Result arrives with structured_output (same content)
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'json-tool-session',
              structured_output: { name: 'Bob' },
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };

        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
          responseFormat: { type: 'json', schema: { type: 'object' } },
        });

        const chunks: any[] = [];
        const reader = result.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Should NOT have duplicate JSON - only the streamed delta
        const textStarts = chunks.filter((c) => c.type === 'text-start');
        const textDeltas = chunks.filter((c) => c.type === 'text-delta');
        const textEnds = chunks.filter((c) => c.type === 'text-end');
        expect(textStarts).toHaveLength(1);
        expect(textDeltas).toHaveLength(1);
        expect(textDeltas[0].delta).toBe('{"name":"Bob"}');
        expect(textEnds).toHaveLength(1);
      });
    });

    it('emits streaming prerequisite warning when images are provided without streaming input', async () => {
      const modelWithStreamingOff = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { streamingInput: 'off' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'warn-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithStreamingOff.doStream({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this image.' },
              { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
            ],
          },
        ],
      } as any);

      const reader = result.stream.getReader();
      const start = await reader.read();
      expect(start.done).toBe(false);
      expect(start.value).toMatchObject({
        type: 'stream-start',
        warnings: expect.arrayContaining([
          expect.objectContaining({
            type: 'other',
            message: STREAMING_WARNING_MESSAGE,
          }),
        ]),
      });

      await reader.cancel();

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(typeof call.prompt).toBe('string');
    });

    it('should emit JSON from structured_output in object-json mode and return finish metadata', async () => {
      // SDK 0.1.45+ returns structured_output directly in the result message
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-session-1',
            structured_output: { a: 1, b: 2 },
            usage: {
              input_tokens: 6,
              output_tokens: 3,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        temperature: 0.5, // This will trigger a warning
        responseFormat: { type: 'json', schema: { type: 'object' } }, // Add responseFormat with schema
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(5);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
        warnings: expect.arrayContaining([
          expect.objectContaining({
            type: 'unsupported',
            feature: 'temperature',
          }),
        ]),
      });
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: '{"a":1,"b":2}',
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[4]).toMatchObject({
        type: 'finish',
        finishReason: { unified: 'stop' },
        usage: {
          inputTokens: { total: 6 },
          outputTokens: { total: 3 },
        },
        providerMetadata: {
          'claude-code': {
            sessionId: 'json-session-1',
            costUsd: 0.001,
            durationMs: 1000,
          },
        },
      });

      // Warnings are now included in the stream-start event
      expect(chunks[0].warnings).toHaveLength(1);
      expect(chunks[0].warnings?.[0]).toMatchObject({
        type: 'unsupported',
        feature: 'temperature',
      });

      // Verify outputFormat was passed to SDK
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: { type: string; schema: unknown } };
      };
      expect(call.options?.outputFormat).toEqual({
        type: 'json_schema',
        schema: { type: 'object' },
      });
    });

    it('should handle structured output error from SDK', async () => {
      // SDK 0.1.45+ returns error_max_structured_output_retries when it can't produce valid output
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_structured_output_retries',
            session_id: 'json-error-session',
            usage: {
              input_tokens: 8,
              output_tokens: 5,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return invalid JSON' }] }],
        responseFormat: { type: 'json', schema: { type: 'object' } },
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should emit stream-start and then error
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
      });
      expect(chunks[1]).toMatchObject({
        type: 'error',
      });
      expect(chunks[1].error.message).toContain('structured output');
    });

    it('should warn and treat as plain text when JSON mode requested without schema', async () => {
      // When responseFormat.type === 'json' but no schema is provided,
      // Claude Code (like Anthropic) does not support JSON-without-schema.
      // We emit an unsupported-setting warning and treat as plain text.
      const plainText = 'Here is some text that happens to look like JSON: {"name": "test"}';
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: plainText }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-no-schema-session',
            // No structured_output field - SDK didn't use outputFormat
            usage: {
              input_tokens: 10,
              output_tokens: 15,
            },
            total_cost_usd: 0.002,
            duration_ms: 200,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' }, // No schema provided
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should emit: stream-start (with warning), text-start, text-delta, text-end, finish
      expect(chunks).toHaveLength(5);

      // Verify unsupported warning is emitted
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
      });
      const streamStartWarnings = chunks[0].warnings;
      expect(streamStartWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'unsupported',
            feature: 'responseFormat',
            details: expect.stringContaining('requires a schema'),
          }),
        ])
      );

      // Verify response is plain text (not parsed or modified)
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: plainText,
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[4]).toMatchObject({
        type: 'finish',
        finishReason: { unified: 'stop' },
        usage: {
          inputTokens: { total: 10 },
          outputTokens: { total: 15 },
        },
      });

      // Verify outputFormat was NOT passed to SDK (no schema)
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: unknown };
      };
      expect(call.options?.outputFormat).toBeUndefined();
    });

    it('emits tool streaming events for provider-executed tools', async () => {
      const toolUseId = 'toolu_123';
      const toolName = 'list_directory';
      const toolInput = { command: 'ls', args: ['-lah'] };
      const toolResultPayload = JSON.stringify([
        { name: 'README.md', size: 1024 },
        { name: 'package.json', size: 2048 },
      ]);

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultPayload,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session',
            usage: {
              input_tokens: 12,
              output_tokens: 3,
            },
            total_cost_usd: 0.002,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'List files' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolInputStart = events.find((event) => event.type === 'tool-input-start');
      const toolInputDelta = events.find((event) => event.type === 'tool-input-delta');
      const toolInputEnd = events.find((event) => event.type === 'tool-input-end');
      const toolCall = events.find((event) => event.type === 'tool-call');
      const toolResult = events.find((event) => event.type === 'tool-result');

      expect(toolInputStart).toMatchObject({
        type: 'tool-input-start',
        id: toolUseId,
        toolName,
        providerExecuted: true,
      });

      expect(toolInputDelta).toMatchObject({
        type: 'tool-input-delta',
        id: toolUseId,
        delta: JSON.stringify(toolInput),
      });

      expect(toolInputEnd).toMatchObject({
        type: 'tool-input-end',
        id: toolUseId,
      });

      expect(events.indexOf(toolInputDelta!)).toBeLessThan(events.indexOf(toolInputEnd!));

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        input: JSON.stringify(toolInput),
        providerExecuted: true,
        providerMetadata: {
          'claude-code': {
            rawInput: JSON.stringify(toolInput),
          },
        },
      });

      expect(events.indexOf(toolInputEnd!)).toBeLessThan(events.indexOf(toolCall!));
      expect(events.indexOf(toolCall!)).toBeLessThan(events.indexOf(toolResult!));

      expect(toolResult).toMatchObject({
        type: 'tool-result',
        toolCallId: toolUseId,
        toolName,
        result: JSON.parse(toolResultPayload),
        providerExecuted: true,
        isError: false,
        providerMetadata: {
          'claude-code': {
            rawResult: toolResultPayload,
          },
        },
      });
    });

    it('propagates parent_tool_use_id into tool stream metadata', async () => {
      const parentToolId = 'toolu_task_parent';
      const toolUseId = 'toolu_child';
      const toolName = 'Bash';
      const toolInput = { command: 'echo "hi"' };

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            parent_tool_use_id: parentToolId,
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            parent_tool_use_id: parentToolId,
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'ok',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-parent-session',
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run command' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolInputStart = events.find((event) => event.type === 'tool-input-start') as
        | (ExtendedStreamPart & {
            type: 'tool-input-start';
            providerMetadata?: Record<string, unknown>;
          })
        | undefined;
      const toolCall = events.find((event) => event.type === 'tool-call') as
        | (ExtendedStreamPart & { type: 'tool-call'; providerMetadata?: Record<string, unknown> })
        | undefined;
      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; providerMetadata?: Record<string, unknown> })
        | undefined;

      expect(toolInputStart).toMatchObject({
        type: 'tool-input-start',
        id: toolUseId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: parentToolId,
          },
        },
      });

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: parentToolId,
          },
        },
      });

      expect(toolResult).toMatchObject({
        type: 'tool-result',
        toolCallId: toolUseId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: parentToolId,
          },
        },
      });
    });

    it('infers parentToolCallId from a single active Task tool', async () => {
      const taskToolId = 'toolu_task';
      const childToolId = 'toolu_child_inferred';
      const childToolName = 'Bash';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: taskToolId,
                  name: 'Task',
                  input: { objective: 'Run command' },
                },
                {
                  type: 'tool_use',
                  id: childToolId,
                  name: childToolName,
                  input: { command: 'ls' },
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: childToolId,
                  name: childToolName,
                  content: 'done',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-fallback-session',
            usage: {
              input_tokens: 2,
              output_tokens: 1,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Do work' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCall = events.find(
        (event) => event.type === 'tool-call' && (event as any).toolCallId === childToolId
      ) as ExtendedStreamPart | undefined;
      const toolResult = events.find(
        (event) => event.type === 'tool-result' && (event as any).toolCallId === childToolId
      ) as ExtendedStreamPart | undefined;

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: childToolId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: taskToolId,
          },
        },
      });

      expect(toolResult).toMatchObject({
        type: 'tool-result',
        toolCallId: childToolId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: taskToolId,
          },
        },
      });
    });

    it('does not infer parentToolCallId when multiple Task tools are active', async () => {
      const taskToolIdA = 'toolu_task_a';
      const taskToolIdB = 'toolu_task_b';
      const childToolId = 'toolu_child_ambiguous';
      const childToolName = 'Bash';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: taskToolIdA,
                  name: 'Task',
                  input: { objective: 'Task A' },
                },
                {
                  type: 'tool_use',
                  id: taskToolIdB,
                  name: 'Task',
                  input: { objective: 'Task B' },
                },
                {
                  type: 'tool_use',
                  id: childToolId,
                  name: childToolName,
                  input: { command: 'pwd' },
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: childToolId,
                  name: childToolName,
                  content: 'ok',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-ambiguous-session',
            usage: {
              input_tokens: 3,
              output_tokens: 1,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Do work' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCall = events.find(
        (event) => event.type === 'tool-call' && (event as any).toolCallId === childToolId
      ) as ExtendedStreamPart | undefined;

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: childToolId,
        providerMetadata: {
          'claude-code': {
            parentToolCallId: null,
          },
        },
      });
    });

    it('normalizes MCP text content arrays into structured results', async () => {
      const toolUseId = 'toolu_mcp_text';
      const toolName = 'mcp_tool';
      const toolInput = { query: 'status' };
      const toolResultContent = [
        { type: 'text', text: '{ "foo": "bar",' },
        { type: 'text', text: '"baz": 1 }' },
      ];

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultContent,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session-text',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
            total_cost_usd: 0.001,
            duration_ms: 120,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Summarize' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; result: unknown })
        | undefined;

      expect(toolResult).toBeDefined();
      expect(toolResult?.result).toEqual({ foo: 'bar', baz: 1 });
    });

    it('preserves non-text MCP content blocks in tool results', async () => {
      const toolUseId = 'toolu_mcp_mixed';
      const toolName = 'mcp_tool';
      const toolInput = { query: 'image' };
      const toolResultContent = [
        { type: 'text', text: 'Here is an image' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ];

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultContent,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session-mixed',
            usage: {
              input_tokens: 6,
              output_tokens: 3,
            },
            total_cost_usd: 0.0015,
            duration_ms: 140,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Show image' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; result: unknown })
        | undefined;

      expect(toolResult).toBeDefined();
      expect(toolResult?.result).toEqual(toolResultContent);
    });

    it('truncates long string tool results in stream metadata', async () => {
      const maxToolResultSize = 100;
      const modelWithLimit = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { maxToolResultSize },
      });
      const toolUseId = 'toolu_truncate_string';
      const toolName = 'Read';
      const toolInput = { file_path: '/tmp/example.txt' };
      const longText = 'x'.repeat(maxToolResultSize + 15);
      const truncatedText = `${longText.slice(0, maxToolResultSize)}\n...[truncated ${
        longText.length - maxToolResultSize
      } chars]`;

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: longText,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session-truncate-string',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
            total_cost_usd: 0.001,
            duration_ms: 80,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await modelWithLimit.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; result: unknown })
        | undefined;

      const metadata = toolResult?.providerMetadata?.['claude-code'] as
        | { rawResult?: string; rawResultTruncated?: boolean }
        | undefined;

      expect(toolResult?.result).toBe(truncatedText);
      expect(metadata?.rawResult).toBe(truncatedText);
      expect(metadata?.rawResultTruncated).toBe(true);
    });

    it('truncates the largest string field in object tool results', async () => {
      const maxToolResultSize = 100;
      const modelWithLimit = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { maxToolResultSize },
      });
      const toolUseId = 'toolu_truncate_object';
      const toolName = 'Read';
      const toolInput = { file_path: '/tmp/example.txt' };
      const longText = 'y'.repeat(maxToolResultSize + 18);
      const truncatedText = `${longText.slice(0, maxToolResultSize)}\n...[truncated ${
        longText.length - maxToolResultSize
      } chars]`;
      const toolResultContent = { short: 'ok', long: longText };

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultContent,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session-truncate-object',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
            total_cost_usd: 0.001,
            duration_ms: 80,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await modelWithLimit.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; result: unknown })
        | undefined;

      const metadata = toolResult?.providerMetadata?.['claude-code'] as
        | { rawResultTruncated?: boolean }
        | undefined;

      expect(toolResult?.result).toEqual({ short: 'ok', long: truncatedText });
      expect(metadata?.rawResultTruncated).toBe(true);
    });

    it('truncates the largest string element in array tool results', async () => {
      const maxToolResultSize = 100;
      const modelWithLimit = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { maxToolResultSize },
      });
      const toolUseId = 'toolu_truncate_array';
      const toolName = 'Read';
      const toolInput = { file_path: '/tmp/example.txt' };
      const longText = 'z'.repeat(maxToolResultSize + 14);
      const truncatedText = `${longText.slice(0, maxToolResultSize)}\n...[truncated ${
        longText.length - maxToolResultSize
      } chars]`;
      const toolResultContent = ['ok', longText, 'done'];

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultContent,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session-truncate-array',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
            total_cost_usd: 0.001,
            duration_ms: 80,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await modelWithLimit.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolResult = events.find((event) => event.type === 'tool-result') as
        | (ExtendedStreamPart & { type: 'tool-result'; result: unknown })
        | undefined;

      const metadata = toolResult?.providerMetadata?.['claude-code'] as
        | { rawResultTruncated?: boolean }
        | undefined;

      expect(toolResult?.result).toEqual(['ok', truncatedText, 'done']);
      expect(metadata?.rawResultTruncated).toBe(true);
    });

    it('finalizes tool calls even when no tool result is emitted', async () => {
      const toolUseId = 'toolu_missing_result';
      const toolName = 'Read';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: { file_path: '/tmp/example.txt' },
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'session-missing-result',
            usage: {
              input_tokens: 5,
              output_tokens: 0,
            },
            total_cost_usd: 0,
            duration_ms: 10,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolInputStartIndex = events.findIndex((event) => event.type === 'tool-input-start');
      const toolInputEndIndex = events.findIndex((event) => event.type === 'tool-input-end');
      const toolCallIndex = events.findIndex((event) => event.type === 'tool-call');
      const toolResultIndex = events.findIndex((event) => event.type === 'tool-result');
      const finishIndex = events.findIndex((event) => event.type === 'finish');

      expect(toolInputStartIndex).toBeGreaterThan(-1);
      expect(toolInputEndIndex).toBeGreaterThan(toolInputStartIndex);
      expect(toolCallIndex).toBeGreaterThan(toolInputEndIndex);
      expect(toolResultIndex).toBe(-1);
      expect(finishIndex).toBeGreaterThan(toolCallIndex);

      const toolCallEvent = events[toolCallIndex];
      expect(toolCallEvent).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        input: JSON.stringify({ file_path: '/tmp/example.txt' }),
        providerExecuted: true,
      });
    });

    it('emits tool-error events for tool failures and orders after tool-call', async () => {
      const toolUseId = 'toolu_error';
      const toolName = 'Read';
      const errorMessage = 'File not found: /nonexistent.txt';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: { file_path: '/nonexistent.txt' },
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_error',
                  tool_use_id: toolUseId,
                  name: toolName,
                  error: errorMessage,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'error-session',
            usage: { input_tokens: 10, output_tokens: 0 },
            total_cost_usd: 0.001,
            duration_ms: 100,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read missing file' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolError = events.find((e) => e.type === 'tool-error');
      const toolCall = events.find((e) => e.type === 'tool-call');

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        providerExecuted: true,
      });

      expect(toolError).toMatchObject({
        type: 'tool-error',
        toolCallId: toolUseId,
        toolName,
        error: errorMessage,
        providerExecuted: true,
      });

      expect(events.indexOf(toolCall!)).toBeLessThan(events.indexOf(toolError!));
    });

    it('emits only one tool-call for multiple tool-result chunks', async () => {
      const toolUseId = 'toolu_chunked';
      const toolName = 'Bash';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: { command: 'echo "test"' },
                },
              ],
            },
          };
          // First result chunk
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'Chunk 1\n',
                  is_error: false,
                },
              ],
            },
          };
          // Second result chunk - same tool_use_id
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'Chunk 2\n',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'chunked-session',
            usage: { input_tokens: 15, output_tokens: 5 },
            total_cost_usd: 0.002,
            duration_ms: 200,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run command' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolResults = events.filter((e) => e.type === 'tool-result');

      expect(toolCalls).toHaveLength(1);
      expect(toolResults).toHaveLength(2);
      expect(toolCalls[0]).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
      });
    });

    it('synthesizes lifecycle for orphaned tool results (no prior tool_use)', async () => {
      const toolUseId = 'toolu_orphan';
      const toolName = 'Read';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'OK',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'orphan-session',
            usage: { input_tokens: 5, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const inputStartIndex = events.findIndex((e) => e.type === 'tool-input-start');
      const inputEndIndex = events.findIndex((e) => e.type === 'tool-input-end');
      const callIndex = events.findIndex((e) => e.type === 'tool-call');
      const resultIndex = events.findIndex((e) => e.type === 'tool-result');

      expect(inputStartIndex).toBeGreaterThan(-1);
      expect(inputEndIndex).toBeGreaterThan(inputStartIndex);
      expect(callIndex).toBeGreaterThan(inputEndIndex);
      expect(resultIndex).toBeGreaterThan(callIndex);
    });

    it('does not emit delta for non-prefix input updates', async () => {
      const toolUseId = 'toolu_nonprefix';
      const toolName = 'TestTool';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          // First chunk
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: toolUseId, name: toolName, input: { arg: 'initial' } },
              ],
            },
          };
          // Second chunk - non-prefix replacement
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: toolUseId, name: toolName, input: { arg: 'replaced' } },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'nonprefix-session',
            usage: { input_tokens: 10, output_tokens: 2 },
            total_cost_usd: 0.001,
            duration_ms: 50,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const deltas = events.filter((e) => e.type === 'tool-input-delta');
      const toolCall = events.find((e) => e.type === 'tool-call') as any;

      expect(deltas).toHaveLength(1);
      expect((deltas[0] as any).delta).toBe(JSON.stringify({ arg: 'initial' }));
      expect(toolCall.input).toBe(JSON.stringify({ arg: 'replaced' }));
    });

    it('emits multiple tool-error chunks without duplicate tool-call', async () => {
      const toolUseId = 'toolu_multi_error';
      const toolName = 'Read';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: { file: 'x' } }],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                { type: 'tool_error', tool_use_id: toolUseId, name: toolName, error: 'e1' },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                { type: 'tool_error', tool_use_id: toolUseId, name: toolName, error: 'e2' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'multierror-session',
            usage: { input_tokens: 1, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolErrors = events.filter((e) => e.type === 'tool-error');
      expect(toolCalls).toHaveLength(1);
      expect(toolErrors).toHaveLength(2);
    });

    it('handles multiple concurrent tool calls', async () => {
      const id1 = 't1';
      const id2 = 't2';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: id1, name: 'Read', input: { p: 'a' } },
                { type: 'tool_use', id: id2, name: 'Bash', input: { c: 'echo' } },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: id1,
                  name: 'Read',
                  content: 'A',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: id2,
                  name: 'Bash',
                  content: 'B',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'concurrent',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);
      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolResults = events.filter((e) => e.type === 'tool-result');
      expect(toolCalls).toHaveLength(2);
      expect(toolResults).toHaveLength(2);
    });

    it('supports interleaved text and tool events', async () => {
      const toolUseId = 'tool_interleave';
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Intro ' }] } };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: { p: '/f' } }],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: 'Read',
                  content: 'OK',
                  is_error: false,
                },
              ],
            },
          };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: ' Outro' }] } };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'inter',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);
      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const firstTextIndex = events.findIndex((e) => e.type === 'text-delta');
      const toolCallIndex = events.findIndex((e) => e.type === 'tool-call');
      const lastTextIndex = events.findIndex(
        (e, i) => i > toolCallIndex && e.type === 'text-delta'
      );
      expect(firstTextIndex).toBeGreaterThan(-1);
      expect(toolCallIndex).toBeGreaterThan(firstTextIndex);
      expect(lastTextIndex).toBeGreaterThan(toolCallIndex);
    });

    it('passes outputFormat to SDK when responseFormat has schema', async () => {
      // SDK 0.1.45+ uses native structured outputs via outputFormat
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'structured-output-session',
            structured_output: { name: 'test', value: 42 },
            usage: { input_tokens: 10, output_tokens: 20 },
            total_cost_usd: 0.002,
            duration_ms: 100,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['name', 'value'],
      };

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
        responseFormat: { type: 'json', schema },
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Verify outputFormat was passed correctly to SDK
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: { type: string; schema: unknown } };
      };
      expect(call.options?.outputFormat).toEqual({
        type: 'json_schema',
        schema,
      });

      // Verify structured output was emitted as text
      const textDelta = events.find((e) => e.type === 'text-delta') as any;
      expect(textDelta).toBeDefined();
      expect(textDelta.delta).toBe('{"name":"test","value":42}');

      const finishEvent = events.find((e) => e.type === 'finish') as any;
      expect(finishEvent).toBeDefined();
      expect(finishEvent.providerMetadata?.['claude-code']?.sessionId).toBe(
        'structured-output-session'
      );
    });

    it('uses consistent fallback name for unknown tools', async () => {
      const toolUseId = 'toolu_unknown_name';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  // name omitted/unknown
                  input: { x: 1 },
                } as any,
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: 'ok',
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-unknown',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCall = events.find((e) => e.type === 'tool-call');
      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolName: 'unknown-tool',
      });
    });

    it('emits finish event with truncated metadata when CLI truncates JSON stream', async () => {
      const repeatedItems = Array.from({ length: 300 }, (_, i) => `item-${i}`).join('","');
      const partialJson = `{"result": {"items": ["${repeatedItems}`;
      const truncationPosition = partialJson.length;
      const truncationError = new SyntaxError(
        `Unterminated string in JSON at position ${truncationPosition}`
      );

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialJson }],
            },
          };
          throw truncationError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const events: LanguageModelV3StreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(events.some((event) => event.type === 'error')).toBe(false);

      const finishEvent = events.find((event) => event.type === 'finish');
      expect(finishEvent).toBeDefined();
      expect(
        finishEvent && 'finishReason' in finishEvent
          ? (finishEvent.finishReason as { unified: string }).unified
          : undefined
      ).toBe('length');

      const finishMetadata =
        finishEvent && 'providerMetadata' in finishEvent ? finishEvent.providerMetadata : undefined;
      const claudeMetadata =
        finishMetadata && 'claude-code' in finishMetadata
          ? (finishMetadata['claude-code'] as Record<string, unknown>)
          : undefined;
      expect(claudeMetadata?.truncated).toBe(true);

      const serializedWarnings = Array.isArray(claudeMetadata?.warnings)
        ? (claudeMetadata?.warnings as Array<Record<string, unknown>>)
        : [];
      expect(
        serializedWarnings.some(
          (warning) =>
            typeof warning.message === 'string' &&
            warning.message.includes('output ended unexpectedly')
        )
      ).toBe(true);

      const textDelta = events.find((event) => event.type === 'text-delta');
      expect(textDelta && 'delta' in textDelta ? textDelta.delta : '').toContain('items');

      const textEnd = events.find((event) => event.type === 'text-end');
      expect(textEnd).toBeDefined();
    });

    it('emits an error event for malformed JSON without treating it as truncation', async () => {
      const partialJson = '{"result": {"items": [1, 2}}';
      const parseError = new SyntaxError('Unexpected token } in JSON at position 24');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialJson }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const errorEvent = events.find((event) => event.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(
        errorEvent && 'error' in errorEvent && errorEvent.error
          ? (errorEvent.error as Error).message
          : ''
      ).toMatch(/Unexpected token \}/);
      expect(events.some((event) => event.type === 'finish')).toBe(false);
    });

    it('should include modelUsage in providerMetadata when available', async () => {
      const mockModelUsage = {
        'claude-sonnet-4-20250514': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 10,
          webSearchRequests: 0,
          costUSD: 0.001,
          contextWindow: 200000,
          maxOutputTokens: 16384,
        },
      };

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'model-usage-session',
            usage: { input_tokens: 100, output_tokens: 50 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            modelUsage: mockModelUsage,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].modelUsage).toEqual(mockModelUsage);
    });

    it('should not include modelUsage in doStream providerMetadata when not available', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'no-model-usage-session',
            usage: { input_tokens: 100, output_tokens: 50 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            // No modelUsage field
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].modelUsage).toBeUndefined();
    });
  });

  describe('SDK 0.3.x stream handling and metadata enrichment', () => {
    it('should include SDK timing metadata in doGenerate providerMetadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'timing-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            ttft_ms: 120,
            ttft_stream_ms: 80,
            time_to_request_ms: 40,
            warm_spare_claimed: true,
            terminal_reason: 'completed',
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown>;
      expect(metadata.ttftMs).toBe(120);
      expect(metadata.ttftStreamMs).toBe(80);
      expect(metadata.timeToRequestMs).toBe(40);
      expect(metadata.warmSpareClaimed).toBe(true);
      expect(metadata.terminalReason).toBe('completed');
      // Existing fields are untouched
      expect(metadata.costUsd).toBe(0.001);
      expect(metadata.durationMs).toBe(500);
    });

    it('should omit timing metadata in doGenerate when absent on the result message', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'no-timing-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown>;
      expect(metadata.ttftMs).toBeUndefined();
      expect(metadata.ttftStreamMs).toBeUndefined();
      expect(metadata.timeToRequestMs).toBeUndefined();
      expect(metadata.warmSpareClaimed).toBeUndefined();
      expect(metadata.terminalReason).toBeUndefined();
    });

    it('should include SDK timing metadata in doStream finish providerMetadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hello' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'stream-timing-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            ttft_ms: 150,
            ttft_stream_ms: 95,
            time_to_request_ms: 55,
            warm_spare_claimed: false,
            terminal_reason: 'completed',
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      const metadata = finishChunk.providerMetadata['claude-code'];
      expect(metadata.ttftMs).toBe(150);
      expect(metadata.ttftStreamMs).toBe(95);
      expect(metadata.timeToRequestMs).toBe(55);
      // false (not just true) is surfaced so consumers can distinguish
      // "reported as not claimed" from "not reported at all"
      expect(metadata.warmSpareClaimed).toBe(false);
      expect(metadata.terminalReason).toBe('completed');
      // Existing fields are untouched
      expect(metadata.costUsd).toBe(0.001);
      expect(metadata.durationMs).toBe(500);
    });

    it('should count api_retry messages into apiRetries in doStream finish metadata', async () => {
      const debug = vi.fn();
      const logger: Logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger, verbose: true },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'api_retry',
            attempt: 1,
            max_retries: 3,
            retry_delay_ms: 1000,
            error_status: 529,
            error: 'overloaded',
            session_id: 'retry-session',
          };
          yield {
            type: 'system',
            subtype: 'api_retry',
            attempt: 2,
            max_retries: 3,
            retry_delay_ms: 2000,
            error_status: 529,
            error: 'overloaded',
            session_id: 'retry-session',
          };
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Recovered' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'retry-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithLogger.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].apiRetries).toBe(2);
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('API retry 1/3'));
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('API retry 2/3'));
    });

    it('should record permission_denied messages in doStream finish metadata and warn', async () => {
      const warn = vi.fn();
      const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'permission_denied',
            tool_name: 'Bash',
            tool_use_id: 'tool-1',
            decision_reason_type: 'rule',
            decision_reason: 'Matched deny rule',
            message: 'Permission denied by rule',
            session_id: 'denied-session',
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'denied-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithLogger.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].permissionDenials).toEqual([
        { toolName: 'Bash', toolUseId: 'tool-1', reason: 'Matched deny rule' },
      ]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Permission denied - Tool: Bash'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Matched deny rule'));
    });

    it('should record api_retry and permission_denied in doGenerate providerMetadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'api_retry',
            attempt: 1,
            max_retries: 3,
            retry_delay_ms: 1000,
            error_status: 529,
            error: 'overloaded',
            session_id: 'gen-meta-session',
          };
          yield {
            type: 'system',
            subtype: 'permission_denied',
            tool_name: 'Write',
            tool_use_id: 'tool-2',
            message: 'Auto-denied in dontAsk mode',
            session_id: 'gen-meta-session',
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'gen-meta-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown>;
      expect(metadata.apiRetries).toBe(1);
      expect(metadata.permissionDenials).toEqual([
        { toolName: 'Write', toolUseId: 'tool-2', reason: 'Auto-denied in dontAsk mode' },
      ]);
    });

    it('should surface PreToolUse-hook denials from the result permission_denials list', async () => {
      // Hook denies bypass canUseTool and emit NO permission_denied system
      // event (SDK docs on SDKPermissionDeniedMessage) — the result message's
      // permission_denials list is the only place they appear.
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'hook-denial-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            permission_denials: [
              { tool_name: 'Bash', tool_use_id: 'hook-tool-1', tool_input: { command: 'rm -rf' } },
            ],
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown>;
      expect(metadata.permissionDenials).toEqual([{ toolName: 'Bash', toolUseId: 'hook-tool-1' }]);
    });

    it('should dedupe result permission_denials against stream-recorded denials by tool_use_id', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'permission_denied',
            tool_name: 'Write',
            tool_use_id: 'tool-9',
            message: 'Auto-denied in dontAsk mode',
            session_id: 'dedupe-session',
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'dedupe-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
            permission_denials: [
              // Same denial as the stream event — must not duplicate
              { tool_name: 'Write', tool_use_id: 'tool-9', tool_input: {} },
              // Hook-only denial — must be appended
              { tool_name: 'Edit', tool_use_id: 'tool-10', tool_input: {} },
            ],
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].permissionDenials).toEqual([
        { toolName: 'Write', toolUseId: 'tool-9', reason: 'Auto-denied in dontAsk mode' },
        { toolName: 'Edit', toolUseId: 'tool-10' },
      ]);
    });

    it('should invoke onPromptSuggestion for the post-result message in doStream', async () => {
      const onPromptSuggestion = vi.fn();
      const modelWithCallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onPromptSuggestion } as any,
      });

      // Use a true generator so iteration continues past the result message,
      // matching the real Query async-generator behavior.
      const mockResponse = (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done' }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'suggestion-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0.001,
          duration_ms: 500,
        };
        yield {
          type: 'prompt_suggestion',
          suggestion: 'Run the test suite next',
          session_id: 'suggestion-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithCallback.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Stream finished normally before the suggestion arrived
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();

      // The suggestion is drained after the stream closes
      await vi.waitFor(() => {
        expect(onPromptSuggestion).toHaveBeenCalledWith('Run the test suite next');
      });
      expect(onPromptSuggestion).toHaveBeenCalledTimes(1);
    });

    it('should invoke onPromptSuggestion in doGenerate', async () => {
      const onPromptSuggestion = vi.fn();
      const modelWithCallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onPromptSuggestion } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'gen-suggestion-session',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
          yield {
            type: 'prompt_suggestion',
            suggestion: 'Try asking about tests',
            session_id: 'gen-suggestion-session',
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithCallback.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      expect(onPromptSuggestion).toHaveBeenCalledTimes(1);
      expect(onPromptSuggestion).toHaveBeenCalledWith('Try asking about tests');
    });

    it('should emit the canonical replacement as a new text part for superseding assistant messages in doStream', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          yield {
            type: 'system',
            subtype: 'model_refusal_fallback',
            trigger: 'refusal',
            direction: 'retry',
            original_model: 'claude-opus-4-6',
            fallback_model: 'claude-sonnet-4-5',
            request_id: 'req-1',
            content: 'Retried on fallback model',
            session_id: 'supersede-session',
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'Replacement answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // The retracted text was already emitted and cannot be un-streamed, but
      // the canonical replacement must still reach the stream: the refused
      // text part is closed and the replacement is emitted as a NEW text part.
      const textDeltas = chunks.filter((c) => c.type === 'text-delta');
      expect(textDeltas.map((c) => c.delta)).toEqual([
        'Refused partial answer',
        'Replacement answer',
      ]);
      // The replacement uses a fresh text part, opened after the refused part closed.
      expect(textDeltas[0].id).not.toBe(textDeltas[1].id);
      const partEvents = chunks
        .filter((c) => ['text-start', 'text-end'].includes(c.type))
        .map((c) => `${c.type}:${c.id === textDeltas[0].id ? 'refused' : 'replacement'}`);
      expect(partEvents).toEqual([
        'text-start:refused',
        'text-end:refused',
        'text-start:replacement',
        'text-end:replacement',
      ]);
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should keep earlier non-retracted text when a supersede arrives in doStream JSON mode', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-kept',
            message: { content: [{ type: 'text', text: 'Kept intro. ' }] },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'Replacement answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-json-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // JSON mode without schema falls back to emitting the accumulated text,
      // which must contain the kept segment plus the replacement - only the
      // retracted segment is dropped (matches doGenerate).
      const streamedText = chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join('');
      expect(streamedText).toBe('Kept intro. Replacement answer');
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should retract superseded segments even when the superseding message carries no text', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-kept',
            message: { content: [{ type: 'text', text: 'Kept intro. ' }] },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          // The SDK does not guarantee the canonical replacement carries text
          // blocks - here it is tool_use-only, and the retraction must still
          // happen on arrival (matches doGenerate).
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: {
              content: [{ type: 'tool_use', id: 'tool-supersede-1', name: 'Read', input: {} }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-no-text-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // JSON mode without schema falls back to emitting the accumulated text,
      // which must no longer contain the retracted segment - only the kept one.
      const streamedText = chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join('');
      expect(streamedText).toBe('Kept intro. ');
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should not re-emit the replacement when it was already streamed via stream_events', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Refused partial answer' },
            },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'text_delta', text: 'Replacement answer' },
            },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'Replacement answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-stream-events-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // The replacement already arrived via stream_event deltas, so the
      // superseding assistant message must not emit it a second time.
      const textDeltas = chunks.filter((c) => c.type === 'text-delta');
      expect(textDeltas.map((c) => c.delta)).toEqual([
        'Refused partial answer',
        'Replacement answer',
      ]);
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should emit unstreamed replacement text even when earlier stream events occurred', async () => {
      // A tool-input stream event sets hasReceivedStreamEvents, but the
      // superseding message's replacement text below never arrives as deltas.
      // The skip decision must gate on the replacement text actually having
      // been streamed, not on the global stream-events flag.
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 1,
              content_block: {
                type: 'tool_use',
                id: 'tool-pre-supersede',
                name: 'Read',
                input: {},
              },
            },
          };
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_stop',
              index: 1,
            },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'Replacement answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-tool-event-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // The canonical replacement was never streamed, so it must be emitted
      // as a new text part despite stream events having occurred.
      const textDeltas = chunks.filter((c) => c.type === 'text-delta');
      expect(textDeltas.map((c) => c.delta)).toEqual([
        'Refused partial answer',
        'Replacement answer',
      ]);
      expect(textDeltas[0].id).not.toBe(textDeltas[1].id);
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should emit an unstreamed replacement even when it is a substring of the refused text', async () => {
      // The replacement text is contained verbatim in the already-emitted
      // refused text. A transcript-wide substring search would false-positive
      // and skip the canonical replacement; the streamed-replacement check
      // must be scoped to deltas attributable to the superseding message.
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'The answer is 4. Actually, I cannot continue with that request.',
                },
              ],
            },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'The answer is 4.' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'supersede-substring-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const textDeltas = chunks.filter((c) => c.type === 'text-delta');
      expect(textDeltas.map((c) => c.delta)).toEqual([
        'The answer is 4. Actually, I cannot continue with that request.',
        'The answer is 4.',
      ]);
      expect(textDeltas[0].id).not.toBe(textDeltas[1].id);
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
    });

    it('should drop superseded thinking traces in doGenerate', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: {
              content: [
                { type: 'thinking', thinking: 'Refused thinking trace' },
                { type: 'text', text: 'Refused partial answer' },
              ],
            },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: {
              content: [
                { type: 'thinking', thinking: 'Replacement thinking trace' },
                { type: 'text', text: 'Replacement answer' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'gen-supersede-thinking-session',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      // Reasoning from the retracted (refused) message is evicted along with
      // its text; only the replacement's thinking survives.
      const reasoningParts = result.content.filter((c: any) => c.type === 'reasoning') as any[];
      expect(reasoningParts.map((c) => c.text)).toEqual(['Replacement thinking trace']);
      expect(result.providerMetadata?.['claude-code']?.thinkingTraces).toEqual([
        'Replacement thinking trace',
      ]);
      const textContent = result.content.find((c: any) => c.type === 'text') as any;
      expect(textContent.text).toBe('Replacement answer');
    });

    it('should drop superseded text segments in doGenerate', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            uuid: 'uuid-refused',
            message: { content: [{ type: 'text', text: 'Refused partial answer' }] },
          };
          yield {
            type: 'assistant',
            uuid: 'uuid-replacement',
            supersedes: ['uuid-refused'],
            message: { content: [{ type: 'text', text: 'Replacement answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'gen-supersede-session',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const textContent = result.content.find((c: any) => c.type === 'text') as any;
      expect(textContent.text).toBe('Replacement answer');
    });

    it('should debug-log and ignore informational SDK 0.3.x system messages in doStream', async () => {
      const debug = vi.fn();
      const logger: Logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const modelWithLogger = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { logger, verbose: true },
      });

      const informationalMessages = [
        { subtype: 'notification', key: 'k', text: 'note', priority: 'low' },
        { subtype: 'status', status: 'requesting' },
        { subtype: 'status', status: null, compact_result: 'failed', compact_error: 'boom' },
        { subtype: 'task_updated', task_id: 't1', patch: { status: 'running' } },
        { subtype: 'session_state_changed', state: 'running' },
        { subtype: 'commands_changed', commands: [] },
        { subtype: 'memory_recall', mode: 'select', memories: [] },
        { subtype: 'plugin_install', status: 'started' },
        {
          subtype: 'mirror_error',
          error: 'append failed',
          key: { projectKey: 'p', sessionId: 's' },
        },
      ];

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          for (const informational of informationalMessages) {
            yield { type: 'system', session_id: 'info-session', ...informational };
          }
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Still working' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'info-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithLogger.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // The stream completes normally with no error chunks
      expect(chunks.find((c) => c.type === 'error')).toBeUndefined();
      expect(chunks.find((c) => c.type === 'finish')).toBeDefined();
      const streamedText = chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join('');
      expect(streamedText).toBe('Still working');

      // Each informational subtype is debug-logged as intentionally ignored
      for (const informational of informationalMessages) {
        expect(debug).toHaveBeenCalledWith(
          expect.stringContaining(`Ignoring informational system message: ${informational.subtype}`)
        );
      }
    });

    it('should accumulate thinking_tokens deltas into estimatedThinkingTokens in doStream finish metadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          // First thinking block: running total grows 40 -> 100
          yield {
            type: 'system',
            subtype: 'thinking_tokens',
            estimated_tokens: 40,
            estimated_tokens_delta: 40,
            session_id: 'thinking-session',
          };
          yield {
            type: 'system',
            subtype: 'thinking_tokens',
            estimated_tokens: 100,
            estimated_tokens_delta: 60,
            session_id: 'thinking-session',
          };
          // Second thinking block: per-block running total resets, so only
          // summing deltas yields the correct cross-block estimate (125).
          yield {
            type: 'system',
            subtype: 'thinking_tokens',
            estimated_tokens: 25,
            estimated_tokens_delta: 25,
            session_id: 'thinking-session',
          };
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Answer' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'thinking-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      expect(finishChunk.providerMetadata['claude-code'].estimatedThinkingTokens).toBe(125);
      // The estimate is not authoritative billed output tokens, so usage is untouched.
      expect(finishChunk.usage.outputTokens.reasoning).toBeUndefined();
    });

    it('should surface estimatedThinkingTokens in doGenerate providerMetadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'thinking_tokens',
            estimated_tokens: 100,
            estimated_tokens_delta: 100,
            session_id: 'gen-thinking-session',
          };
          yield {
            type: 'system',
            subtype: 'thinking_tokens',
            estimated_tokens: 150,
            estimated_tokens_delta: 50,
            session_id: 'gen-thinking-session',
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'gen-thinking-session',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown>;
      expect(metadata.estimatedThinkingTokens).toBe(150);
      expect(result.usage.outputTokens.reasoning).toBeUndefined();
    });

    it('should include apiRetries and permissionDenials in the truncation-recovery finish metadata', async () => {
      // Long enough to pass the truncation-detection length threshold
      const longText = 'A'.repeat(600);
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'api_retry',
            attempt: 1,
            max_retries: 3,
            retry_delay_ms: 1000,
            error_status: 529,
            error: 'overloaded',
            session_id: 'truncated-session',
          };
          yield {
            type: 'system',
            subtype: 'permission_denied',
            tool_name: 'Bash',
            tool_use_id: 'tool-1',
            decision_reason: 'Matched deny rule',
            session_id: 'truncated-session',
          };
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: longText }] },
          };
          throw new SyntaxError('Unexpected end of JSON input');
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const finishChunk = chunks.find((c) => c.type === 'finish');
      const metadata = finishChunk.providerMetadata['claude-code'];
      expect(metadata.truncated).toBe(true);
      expect(metadata.apiRetries).toBe(1);
      expect(metadata.permissionDenials).toEqual([
        { toolName: 'Bash', toolUseId: 'tool-1', reason: 'Matched deny rule' },
      ]);
    });

    it('should stop the post-result drain after the first prompt_suggestion', async () => {
      const onPromptSuggestion = vi.fn();
      const modelWithCallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onPromptSuggestion } as any,
      });

      let yieldedAfterSuggestion = false;
      let generatorClosed = false;
      const mockResponse = (async function* () {
        try {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Done' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'bounded-drain-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001,
            duration_ms: 500,
          };
          yield {
            type: 'prompt_suggestion',
            suggestion: 'Run the test suite next',
            session_id: 'bounded-drain-session',
          };
          yieldedAfterSuggestion = true;
          // Simulate a lingering CLI that never exits on its own.
          await new Promise(() => {});
        } finally {
          generatorClosed = true;
        }
      })();

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithCallback.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      });

      const reader = result.stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      await vi.waitFor(() => {
        expect(onPromptSuggestion).toHaveBeenCalledWith('Run the test suite next');
        // The drain closes the SDK iterator after the (at most one per turn)
        // suggestion instead of holding the subprocess open indefinitely.
        expect(generatorClosed).toBe(true);
      });
      expect(yieldedAfterSuggestion).toBe(false);
    });

    it('should time out the post-result drain when no prompt_suggestion arrives', async () => {
      const debug = vi.fn();
      const logger: Logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const onPromptSuggestion = vi.fn();
      const modelWithCallback = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { onPromptSuggestion, logger, verbose: true } as any,
      });

      const mockResponse = (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done' }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'drain-timeout-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0.001,
          duration_ms: 500,
        };
        // Lingering CLI: never emits a prompt_suggestion and never exits.
        await new Promise(() => {});
      })();

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      vi.useFakeTimers();
      try {
        const result = await modelWithCallback.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        });

        const reader = result.stream.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }

        await vi.advanceTimersByTimeAsync(10_000);

        expect(onPromptSuggestion).not.toHaveBeenCalled();
        expect(debug).toHaveBeenCalledWith(
          expect.stringContaining('Post-result drain timed out; closing SDK iterator')
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('unsupported call option warnings', () => {
    const mockSimpleResponse = () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hello' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'warnings-session',
            usage: { input_tokens: 5, output_tokens: 2 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);
    };

    it('should warn when AI SDK tools are provided', async () => {
      mockSimpleResponse();

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        tools: [
          {
            type: 'function',
            name: 'getWeather',
            description: 'Get the weather',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      } as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'unsupported',
          feature: 'tools',
          details: expect.stringContaining('createAiSdkMcpServer'),
        })
      );
      const toolsWarning = result.warnings.find(
        (w: any) => w.type === 'unsupported' && w.feature === 'tools'
      ) as any;
      expect(toolsWarning?.details).toContain('mcpServers');
    });

    it('should not warn when tools array is empty', async () => {
      mockSimpleResponse();

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        tools: [],
      } as any);

      expect(result.warnings).not.toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'tools' })
      );
    });

    it('should warn when toolChoice is set to a non-auto value', async () => {
      mockSimpleResponse();

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        toolChoice: { type: 'required' },
      } as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'unsupported',
          feature: 'toolChoice',
          details: expect.stringContaining("'required'"),
        })
      );
    });

    it('should warn when toolChoice requests a specific tool', async () => {
      mockSimpleResponse();

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        toolChoice: { type: 'tool', toolName: 'getWeather' },
      } as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'unsupported',
          feature: 'toolChoice',
        })
      );
    });

    it('should not warn when toolChoice is auto or unset', async () => {
      mockSimpleResponse();

      const autoResult = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        toolChoice: { type: 'auto' },
      } as any);

      expect(autoResult.warnings).not.toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'toolChoice' })
      );

      mockSimpleResponse();

      const unsetResult = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      expect(unsetResult.warnings).not.toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'toolChoice' })
      );
    });

    it('should warn when maxOutputTokens is set', async () => {
      mockSimpleResponse();

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        maxOutputTokens: 1024,
      } as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'unsupported',
          feature: 'maxOutputTokens',
          details: expect.stringContaining('output token cap'),
        })
      );
    });

    it('should emit the warnings on the doStream stream-start event', async () => {
      mockSimpleResponse();

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
        tools: [
          {
            type: 'function',
            name: 'getWeather',
            description: 'Get the weather',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        toolChoice: { type: 'none' },
        maxOutputTokens: 256,
      } as any);

      const reader = result.stream.getReader();
      const { value: first } = await reader.read();
      await reader.cancel();

      expect(first).toMatchObject({ type: 'stream-start' });
      const warnings = (first as any).warnings;
      expect(warnings).toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'tools' })
      );
      expect(warnings).toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'toolChoice' })
      );
      expect(warnings).toContainEqual(
        expect.objectContaining({ type: 'unsupported', feature: 'maxOutputTokens' })
      );
    });
  });
});
