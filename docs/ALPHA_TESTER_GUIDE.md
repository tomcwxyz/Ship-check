# Ship Check Alpha 0.9 tester guide

**Alpha version:** 0.0.0-alpha.9

Thanks for trying Ship Check. This is a small external alpha: we are testing whether the product is understandable and useful on real projects, not asking you to prove that every check is correct.

A useful test should take around 20–30 minutes.

## What Ship Check does

Ship Check reviews the evidence you give it and separates:

- **Findings** — evidence supports a concrete concern.
- **Unverified** — something relevant exists, but Ship Check cannot establish whether the control is adequate.
- **Observed** — useful project context, not a problem or a pass.
- **Coverage** — what Ship Check did and did not assess.

A quiet scan means **no confirmed findings in the areas checked**. It does not mean a project is safe or production-ready.

## Before you start

Use a real project you understand reasonably well. A small or medium project is ideal for a first test.

Ship Check is local-first. Local-folder scans do not upload your source to Ship Check. GitHub scans use a temporary checkout. The optional OSV dependency check uses the network and is off by default.

Reports can contain local paths and bounded evidence locations. Secret values should be redacted by Ship Check, but please review a report before posting it publicly.

Commit or back up any project changes before acting on repair guidance.

## Option 1 — desktop app

Download **Ship Check 0.0.0-alpha.9** from the GitHub pre-release:

https://github.com/tomcwxyz/Ship-check/releases/tag/ship-check-desktop-v0.0.0-alpha.9

Choose the build for your machine:

- **Windows x64** — `Ship.Check_0.0.0-alpha.9_x64-setup.exe`
- **macOS Apple Silicon** — `Ship.Check_0.0.0-alpha.9_aarch64.app.zip`
- **Linux x64** — `Ship.Check_0.0.0-alpha.9_amd64.deb`

The Windows build is currently unsigned. Windows may show a SmartScreen warning.

The macOS build is ad-hoc signed but not Apple-notarised. Unzip it, move **Ship Check.app** to Applications and, if macOS blocks the first launch, approve it in **System Settings → Privacy & Security**.

Then:

1. Choose **Folder** and select one real project.
2. Run the default review.
3. Read the coverage summary before looking at individual findings.
4. Open the suggested **Next action**.
5. Decide whether the FIX or VERIFY instruction makes sense to you.
6. If appropriate, make one small change or carry out one verification.
7. Run Ship Check again and see whether the before/after story is understandable.

If you have several projects in one development folder, you can also try **Folder of projects** after the single-project test.

## Option 2 — npm / npx

You need Node.js 22.12 or later.

From a project directory:

```bash
npx --yes @good-ship/ship-check@alpha scan . --format markdown
```

For a complete JSON report that can be used in the repair loop:

```bash
npx --yes @good-ship/ship-check@alpha scan . --format json > before.json
```

Ask Ship Check for one focused next action:

```bash
npx --yes @good-ship/ship-check@alpha focus before.json
```

After making or checking one narrowly scoped change:

```bash
npx --yes @good-ship/ship-check@alpha scan . --format json > after.json
npx --yes @good-ship/ship-check@alpha compare before.json after.json --format markdown
```

For an explicit Git-history credential check:

```bash
npx --yes @good-ship/ship-check@alpha scan . --git-history-secrets --format markdown
```

The dependency-vulnerability lookup is deliberately opt-in because it may query the OSV service with package identifiers and versions:

```bash
npx --yes @good-ship/ship-check@alpha scan . --networked-dependency-scan --format markdown
```

## What we want to learn

We are particularly interested in whether:

- installation and the first scan are straightforward;
- the difference between a **finding**, **unverified**, **observed** and **not assessed** is clear;
- the things Ship Check surfaces feel useful rather than merely technically true;
- something important is obviously missing;
- the suggested FIX or VERIFY action is specific enough to act on;
- rerunning after an action gives you a useful sense of what changed;
- you trust the product to say when it does **not** have enough evidence.

Please do not spend time trying to make every warning disappear. Confusing, noisy or apparently wrong output is useful alpha feedback.

## Feedback

Open an issue at:

https://github.com/tomcwxyz/Ship-check/issues

A short report is enough. If possible, include:

- operating system;
- desktop or npx;
- broad project type or stack;
- what was immediately useful;
- anything confusing, noisy or apparently wrong;
- anything important you expected Ship Check to notice but it missed;
- whether you could complete one FIX or VERIFY loop;
- the single thing you would change first.

You do not need to share source code or a complete Ship Check report. Please redact anything sensitive from excerpts.

## Current alpha limitations

This is not a penetration test, compliance audit or certification.

The Windows installer is unsigned and the macOS app is not notarised. Some checks are intentionally narrow, some controls will remain unverified without stronger evidence, and OSV/Semgrep deeper checks are optional rather than silently assumed.

That incompleteness is part of what we are testing: Ship Check should be useful while being explicit about what it does not know.
