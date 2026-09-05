---
name: bump-upstream
description: Bump the Yarn Spinner upstream conformance submodule pin to a new ref, run the conformance suite, and triage every failure into gap tickets, harness fixes, or allowlist cleanups. Use whenever the upstream pin should move — routine tag bumps and lookahead triage alike.
---

# Bump the upstream conformance pin

The conformance corpus is the git submodule at `test/fixtures/upstream/YarnSpinner/`
(provenance and current pin: `test/fixtures/upstream/PROVENANCE.md`). This skill
moves the pin, proves the suite, and turns every failure into a recorded
decision. It is the whole routine — no helper scripts; triage judgment lives
here.

## 0. Preconditions

- The submodule must be checked out. If `test/fixtures/upstream/YarnSpinner/Tests`
  is absent, run `git submodule update --init --recursive` first (the suite
  hard-fails with this exact command otherwise).
- The submodule is a **full clone** (not shallow), normally detached at the pin.

## 1. Pick the target ref

- **Default: the latest upstream release tag** from
  https://github.com/YarnSpinnerTool/YarnSpinner/releases (verify in the
  submodule itself: `git -C test/fixtures/upstream/YarnSpinner ls-remote --tags origin`).
- `main` or a `feature/*` branch **only for lookahead triage** — and pins
  settle on tags: a lookahead run must either return to the previous tag pin
  or justify settling on the new tag.

## 2. Move the pin

Fetch inside the submodule, then check out the target ref. Note: on macOS the
osxkeychain helper can fail **any** network git call (fetch, ls-remote, …)
with `fatal: failed to store: -60008`; bypass it with `-c credential.helper=`
on every remote-touching command (public repo, no credentials needed).
Paths below are run from the repo root (the submodule is four levels down).

```bash
git -C test/fixtures/upstream/YarnSpinner fetch --tags origin   # add -c credential.helper= if -60008 appears
git -C test/fixtures/upstream/YarnSpinner checkout <tag-or-ref>
git add test/fixtures/upstream/YarnSpinner   # stage the new gitlink pin
```

Do not edit anything inside the submodule — ever. Upstream is the source of
truth (`CODING_STANDARDS.md` §1); divergences are triaged in step 4.

## 3. Run the conformance suite

```bash
npm test
```

The full suite is the verdict. Note the current baseline test count before
judging deltas (it moves only when tests are added/removed in this repo, not
by the pin).

## 4. Triage every failure

- **Real parity gap**: the new fixtures/behavior expose something this
  compiler/runtime doesn't do yet. File a gap ticket under `.scratch/` (per
  `docs/agents/issue-tracker.md`), then add the matching allowlist entry in
  `src/tests/upstream-conformance.test.ts` (`COMPILE_CLEAN_ALLOWLIST` or
  `PLAN_RUN_ALLOWLIST`) **citing the ticket**. The suite must be green again
  with the entry in place before the bump is recorded.
- **Harness bug**: our testplan parser, fixture discovery, or event-stream
  comparison is wrong. Fix the harness in this repo (not the fixtures), keep
  the pin, rerun.
- **Stale allowlist entry**: a previously-allowed fixture now passes (or a
  must-fail now compiles). Clean the entry — the suite self-reports stale
  entries — and note the fix in the gap ticket it closed.

Anything that fits none of these (e.g. an upstream harness semantic we never
ported) is still a **parity gap**: file it, allowlist it, and let the parity
roadmap absorb it.

**Test bump (same step, after the verdicts) — the fixture sweep is not the
whole upstream suite:** the upstream test project at
`test/fixtures/upstream/YarnSpinner/YarnSpinner.Tests/` (GitHub mirror:
https://github.com/YarnSpinnerTool/YarnSpinner/tree/main/YarnSpinner.Tests)
pins behaviors the testplans never touch: parser recovery, the type matrix,
initial values, project-file schema features, smart variables, saliency. A
pin bump that moves those C# tests is a behavior change this repo must
**replicate in its own test suite**, not just survive. After moving the pin,
diff the upstream test project across the bump:

```bash
git -C test/fixtures/upstream/YarnSpinner diff --stat <old-pin>..<new-pin> -- YarnSpinner.Tests/
```

Every new or changed upstream test area gets exactly one verdict:

- **Port it now** — small and parity-critical: add a mirrored test in this
  repo following the established port pattern
  (`src/tests/upstreamUnitPorts.test.ts` — expectation mirrors the upstream
  test, messages quoted from upstream source, severities from the Definitions
  registry). A port is a first-class test and asserts exactly the upstream
  expectation.
- **File a coverage-gap ticket** — larger or lower-priority: cite the
  upstream test file/method (per the tracker conventions), record it in the
  tracker's coverage matrix, and port it when the ticket lands.
- **N/A** — out-of-scope surfaces (Unity/editor, debugger, analysis,
  language-server, upgrader); record why so the next bump doesn't
  re-litigate it.

Each bump's diff keeps the tracker's coverage matrix — the standing audit of
which upstream behaviors this repo pins — current.

## 5. Record the bump

Append one line to the **Pin history** section of
`test/fixtures/upstream/PROVENANCE.md`:

```
- <date>: <old pin> → <new pin> — <tag or branch, triage outcome: green / N gap
tickets filed (links) / harness fixes, plus test-diff outcome: ports added /
tickets filed / all N/A>
```

If the bump revealed corrections to this skill (a wrong step, a missing
recovery path), edit this SKILL.md in the same change — the skill is the
routine; it must stay the tested truth.

## 6. Done when

The pin is staged (or committed) at the new ref, the suite is green with
allowlists reconciled, the `YarnSpinner.Tests/` diff is fully triaged (ports
added or tickets filed), PROVENANCE.md carries the new history line, and
every failure has a ticket or a fix.
