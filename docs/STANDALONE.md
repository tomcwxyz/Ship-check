# Standalone engine

Ship Check's TypeScript packages remain the canonical checking implementation. The desktop application and RACK integration should not grow separate copies of the rules.

For distribution, the CLI can be compiled into a self-contained native executable with Bun after the normal pnpm build:

```bash
pnpm install
pnpm build:engine
```

The resulting development artefact is written under `dist/` (`ship-check` on Unix-like systems; platform packaging may use an `.exe` name on Windows). Running the compiled engine does not require Node, pnpm or Bun on the user's machine.

## Why this boundary

The standalone executable gives us one implementation that can serve three surfaces:

1. direct CLI use;
2. a Tauri desktop app invoking a bundled/local trusted sidecar;
3. RACK invoking a locally discovered trusted Ship Check executable for automatic Verification Plan steps.

The process boundary is intentional. RACK and the Ship Check desktop consume versioned JSON contracts rather than importing the scanner's UI code or allowing a Rack/shared-practice file to supply arbitrary executable commands.

## Build trust

Normal repository validation now:

- runs all checks/tests/builds;
- runs Ship Check against its own repository with a `high` severity gate;
- compiles the standalone engine;
- smoke-tests the compiled binary against the safe Cost Aware fixture.

Platform releases compile the engine on the target operating system rather than checking generated executables into source control. Desktop packaging should bind a known engine version and record it in release provenance.

## Manual alpha release

The `Standalone engine alpha release` workflow is deliberately manual. Dispatch it from `main` with:

- `version` matching the root `package.json` version;
- `confirm` set to `ALPHA`.

The workflow reruns validation, creates a **draft pre-release**, compiles native Windows x64 and Linux x64 engines, smoke-tests each binary and uploads them to that draft. Builds are unsigned during alpha, so Windows warnings are expected.

The draft stays unpublished until a person reviews the assets. A failed platform build therefore cannot silently publish an incomplete release.

## Next packaging step

When `apps/desktop` lands, its native layer should invoke the bundled engine with explicit arguments and parse `0.1` JSON. The user must review the selected project folder and scan packs before execution. The desktop must not use a shell command string or execute commands supplied by repository content, TOPO context or RACK shared practice.
