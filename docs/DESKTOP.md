# Desktop alpha

The desktop app is a repository review surface over the same Ship Check engine used by the CLI and ecosystem adapters. It deliberately does not contain a second implementation of checks.

## User flow

1. Choose **Local folder** or **GitHub repo**.
2. Select a local project, or enter `owner/repository` / a github.com repository URL and optionally a branch or tag.
3. Choose one or more bounded check packs.
4. Run the local engine.
5. Review severity, evidence, remediation and verification guidance.
6. Copy a repair prompt if useful, make changes in the tool of your choice, then run Ship Check again.

The first alpha keeps the complete findings list visible with severity filters. A focused one-finding-at-a-time mode can be added after we have tested the review flow against larger real repositories.

## Trust boundary

The native layer invokes known executables directly with `std::process::Command`. It never passes a shell command string.

For a normal local scan, only these values can vary:

- the project folder selected by the user;
- allow-listed pack IDs: `secure-build`, `production-ready`, `cost-aware`.

For a GitHub scan, Ship Check additionally accepts:

- a repository in `owner/repository`, `https://github.com/owner/repository`, GitHub SSH or `ssh://git@github.com/...` form;
- an optional branch or tag.

GitHub repository hosts are constrained to `github.com`. HTTPS URLs containing embedded usernames, passwords or tokens are rejected. Refs beginning with `-`, containing line breaks/null bytes, or exceeding the bounded length are rejected before Git is invoked.

The Git process is a direct, shallow, single-branch clone with a two-minute timeout. `GIT_TERMINAL_PROMPT=0` prevents an invisible terminal prompt from hanging the desktop app. Existing credential-manager state or SSH keys may still allow access to private repositories.

The desktop fixes the engine arguments to `scan`, `--format json` and `--fail-on never`. Repository content, TOPO context and RACK shared practice cannot supply commands or replace the executable path.

The engine is resolved in this order:

1. `SHIP_CHECK_ENGINE_PATH`, intended for explicit local development/testing;
2. the app resource directory;
3. the installed executable directory;
4. the repository `dist/` engine during development.

Release packaging compiles the engine from the same commit on each target runner and places it into the Tauri resource bundle before building the installer.

## Data handling

A local-folder scan reads the selected project in place and does not upload source.

A GitHub scan downloads a shallow checkout into the operating system's temporary directory, runs the same local engine against it, then removes that checkout when the scan returns or errors. Ship Check itself does not send repository content to a hosted Ship Check service.

The initial app does not retain source content or persist scan history. Evidence excerpts are only rendered in the current review session.

Ship Check results are assurance evidence for human review, not a security or compliance certification.

## Local development

From the repository root:

```bash
pnpm install
pnpm build:engine
pnpm desktop:assets
cargo install tauri-cli --version "^2.0.0" --locked
cd apps/desktop
cargo tauri dev
```

`desktop:assets` creates the platform icon files from the small checked-in icon source. The generated PNG/ICO files are build artefacts and stay out of source control.

You can also point the desktop at another locally built engine:

```bash
SHIP_CHECK_ENGINE_PATH=/absolute/path/to/ship-check-engine cargo tauri dev
```

On PowerShell:

```powershell
$env:SHIP_CHECK_ENGINE_PATH = "C:\path\to\ship-check-engine.exe"
cargo tauri dev
```

GitHub mode also requires Git to be installed and available to the desktop process.

## Release cost discipline

Normal desktop validation only runs when `apps/desktop/**` or its asset generator changes. Multi-platform Windows/Linux packaging is manual through the Desktop alpha release workflow and requires an explicit `ALPHA` confirmation. This keeps native runner work tied to intentional releases rather than every development commit.
