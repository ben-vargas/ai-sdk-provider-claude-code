# Repository Guidelines

## Project Structure & Module Organization

- Provider code and utilities sit in `src/`; each module keeps a matching `*.test.ts` (for example, `src/claude-code-provider.ts`).
- Executable samples live in `examples/`; rebuild first, then run with `npx tsx ...` to exercise streaming or tool flows.
- Long-form docs and migration notes are under `docs/ai-sdk-v5/` and `docs/ai-sdk-v4/`; touch both when behavior diverges, and ignore generated `dist/` artifacts.

## Build, Test, and Development Commands

- `npm run build` → `tsup` build for CJS/ESM bundles.
- `npm run dev` → watch mode for rapid iterations.
- `npm run lint` / `npm run typecheck` → ESLint plus `tsc --noEmit` to keep APIs strict.
- `npm run test` (or `:node` / `:edge`) → Vitest suites per runtime; include `npm run test:integration` before publishing.
- `npm run example:streaming` (or `run-all-examples.sh`) → smoke-test streaming tools described in `TOOL_STREAMING.md`.

## Coding Style & Naming Conventions

- 2-space indentation, `const` first, and no implicit `any`; ESLint enforces the ruleset and only relaxes the constraint inside tests.
- File names stay kebab-case, exports are named, and TypeScript types/interfaces remain PascalCase.
- Factor shared behaviors into helpers like `mcp-helpers.ts` or `logger.ts` instead of duplicating logic.

## Testing Guidelines

- Keep tests beside the module (`foo.ts` ↔ `foo.test.ts`) and mirror the API surface you touch.
- Exercise Node and edge shim paths with `npm run test:node` and `npm run test:edge`; add scenario coverage in `examples/` when reproducing tool or streaming regressions.
- Run `npx vitest run --coverage` (V8) before tagging a release and address drops introduced by new branches.

## Commit & Pull Request Guidelines

- Use conventional commits (`feat:`, `fix(scope):`, `chore:`) as in the log; reserve breaking changes for the body with a clear callout.
- Reference issues with `#NN`, list the commands you ran, and include relevant screenshots or CLI transcripts when workflows change.
- Update companion docs (`README.md`, `TOOL_STREAMING.md`, `docs/ai-sdk-v5/GUIDE.md`) in the same PR whenever behavior or configuration shifts.

## Security & Configuration Tips

- Authenticate locally via `claude auth login` before running examples and never commit CLI state; expose new options through `src/types.ts` with well-documented defaults.
