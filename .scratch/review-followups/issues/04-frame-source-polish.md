# 04: Frame-source polish — pinned-import errors quote the right source

**What to build:** The thrice-deferred polish (direct-import ticket 04 → 05 → "docs ticket" → dropped): a pinned-import build error's caret frame quotes the project JSON while its loc points into a `.yarn` source. With the severity-cluster's async `asBuildError` now carrying diagnostic-file loc, finish the job: the frame must quote the file the loc points into (read the right source, per-diagnostic). Pins: a pinned import whose error is in a `.yarn` source produces a frame quoting that source at the loc's line; a YP-level error quotes the project JSON.

**Alternative the executor may take if the plumbing proves disproportionate:** explicitly close the deferral — record on this ticket and in docs/direct-import.md that the frame quotes the compilation entry source, as a documented limitation. Implementing is preferred; closing is the fallback, not a silent drop.

**Blocked by:** None.

**Status:** resolved

## Answer

Implemented — the fallback was not needed. The severity-cluster's async `asBuildError` already read the diagnostic's own file when it differed from the imported id, but the read silently missed for project loads: those diagnostics carry paths **relative to the `.yarnproject`** (the loader reports source paths project-relative), so `readFile(file)` read against the process cwd, fell into `catch(() => "")`, and the frame quoted nothing — exactly the quoted-wrong-source failure the ticket describes, one step worse.

Fix in `packages/vite-plugin/src/index.ts`: `asBuildError` takes the compilation entry's directory as `baseDir` and resolves non-absolute diagnostic files against it before reading (the load hook passes `dirname(projectFile)` for the project/pinned path, `dirname(file)` for standalone `.yarn` loads; absolute diagnostic files — e.g. standalone compile attribution — pass through unchanged). The frame now quotes the file the loc points into, per-diagnostic.

Pins added to `src/tests/vitePluginProject.test.ts`: a pinned import whose error is in a `.yarn` source produces a frame quoting that source at the loc's exact line (compared line-for-line against the file) with the caret line under it, and no project JSON; a YP-level error (missing `baseLanguage`, YP0003) quotes the project JSON's loc line. This also strengthens the pre-existing unpinned pin, which passed vacuously against the empty-frame bug.

- [x] Pinned import with a .yarn-source error → frame quotes that source at the loc's line
- [x] YP-level error → frame quotes the project JSON
- [x] Implemented (deferral closed by landing, not by documentation)
