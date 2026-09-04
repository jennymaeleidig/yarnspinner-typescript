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

## 4. Triage every failure — exactly one of three verdicts

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

**Coverage diff (same step, after the verdicts):** upstream's test suite is
not only its fixture sweep — `YarnSpinner.Tests/*.cs` pins behaviors the
testplans never touch (parser recovery, type matrices, initial values,
project-file schema features). After moving the pin, diff the upstream suite
across the bump:

```bash
git diff <old-pin>..<new-pin> --stat -- YarnSpinner.Tests/   # inside the submodule
```

Every new or changed upstream test area gets a verdict: **port it now**
(small, parity-critical), **file a coverage-gap ticket** citing the upstream
test file/method (per the tracker conventions), or **N/A** (Unity/editor,
debugger, analysis, language-server, upgrader — recorded out-of-scope
surfaces). The baseline matrix is the standing coverage audit in the
tracker; each bump's diff keeps it current.

Anything that is none of these (e.g. an upstream harness semantic we never
ported) is still a parity gap: file it, allowlist it, and let the parity
roadmap absorb it.

## 5. Record the bump

Append one line to the **Pin history** section of
`test/fixtures/upstream/PROVENANCE.md`:

```
- <date>: <old pin> → <new pin> — <tag or branch, triage outcome: green / N gap tickets filed (links) / harness fixes>
```

If the bump revealed corrections to this skill (a wrong step, a missing
recovery path), edit this SKILL.md in the same change — the skill is the
routine; it must stay the tested truth.

## 6. Done when

The pin is staged (or committed) at the new ref, the suite is green with
allowlists reconciled, PROVENANCE.md carries the new history line, and every
failure has a ticket or a fix.
