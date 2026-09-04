# Desktop alpha

The desktop app is a local review surface over the same Ship Check engine used by the CLI and ecosystem adapters. It deliberately does not contain a second implementation of checks.

## User flow

1. Choose a project folder with the native folder picker.
2. Choose one or more bounded check packs.
3. Run the local engine.
4. Review severity, evidence, remediation and verification guidance.
5. Copy a repair prompt if useful, make changes in the tool of your choice, then run Ship Check again.

The first alpha keeps the complete findings list visible with severity filters. A focused one-finding-at-a-time mode can be added after we have tested the review flow against larger real repositories.

## Trust boundary

The native layer invokes a known Ship Check executable directly with `std::process::Command`. It never passes a shell command string.

Only these values can vary:

- the project folder selected by the user;
- allow-listed pack IDs: `secure-build`, `production-ready`, `cost-aware`.

The desktop fixes the remaining arguments to `scan`, `--format json` and `--fail-on never`. Repository content, TOPO context and RACK shared practice cannot supply commands or replace the executable path.

The engine is resolved in this order:

1. `SHIP_CHECK_ENGINE_PATH`, intended for explicit local development/testing;
2. the app resource directory;
3. the installed executable directory;
4. the repository `dist/` engine during development.

Release packaging compiles the engine from the same commit on each target runner and places it into the Tauri resource bundle before building the installer.

## Data handling

A desktop scan reads the selected project locally. The initial app does not upload source, retain source content, or persist scan history. Evidence excerpts are only rendered in the current review session.

Ship Check results are assurance evidence for human review, not a security or compliance certification.

## Local development

From the repository root:

```bash
pnpm install
pnpm build:engine
cargo install tauri-cli --version "^2.0.0" --locked
cd apps/desktop
cargo tauri dev
```

You can also point the desktop at another locally built engine:

```bash
SHIP_CHECK_ENGINE_PATH=/absolute/path/to/ship-check-engine cargo tauri dev
```

On PowerShell:

```powershell
$env:SHIP_CHECK_ENGINE_PATH = "C:\path\to\ship-check-engine.exe"
cargo tauri dev
```

## Release cost discipline

Normal desktop validation only runs when `apps/desktop/**` changes. Multi-platform Windows/Linux packaging is manual through the Desktop alpha release workflow and requires an explicit `ALPHA` confirmation. This keeps native runner work tied to intentional releases rather than every development commit.
