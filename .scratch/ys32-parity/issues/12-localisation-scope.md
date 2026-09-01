# Localisation scope decision

Type: grilling
Status: resolved
Blocked by: 11 *(resolved — see [research/localisation-mechanics.md](../research/localisation-mechanics.md). Research recommendation to react to: compiler layer + CSV module, no `.yarnproject` equivalent, injectable runtime text-provider seam; compiler-layer parity first.)*

## Question

Using the [localisation mechanics deep dive](./11-localisation-mechanics.md): decide what localisation the first spec includes. Candidates: string-table export (CSV columns/language/id/text/file/node/lineNumber/lock/comment), `///` doc comments, explicit `#line:` + `#shadow:` tag handling, implicit line-ID generation (replace the fork's global-counter scheme with upstream's RandomLineTagGenerator semantics?), pluggable line-tag generators, runtime string lookup by line ID (upstream `Localization` + `LanguageCode`), and any `.yarnproject`-equivalent project file. Decide also the phasing: full parity vs strings-only first.

## Answer

All recommendations confirmed by the maintainer:

1. **Full compiler layer, first spec**: implicit line IDs via upstream's CRC32(file+node+count) (replacing the fork's global counter), explicit `#line:` verbatim, `#shadow:` with compile-time validation (YS0042/43/44; text nulled, never in table), string table as compile output (`{lineID → text, file, node, lineNumber, isImplicitTag, metadata, shadowLineID}`).
2. **CSV module included**: 8-column strings files (`language,id,text,file,node,lineNumber,lock,comment`), `lock` = first-8-hex SHA-256 of base text, `comment` = line hashtag metadata; plus a **strings-only compile mode** (StringsOnly equivalent).
3. **Line-tag generator seam + both built-ins** (`RandomLineTagGenerator` default, `DescriptiveLineTagGenerator`) included, **with the `tagLines(source, { generator })` source-rewriting utility** (adopting ticket 11's recommendation).
4. **No `.yarnproject` equivalent** — confirmed out of scope; program + string-table compile API suffices.
5. **CSV-backed runtime translation provider ships in the first spec** (`setLanguage`) on top of the text-provider seam from ticket 05 — localisation usable end-to-end at launch.

Note: `///` doc comments attach to declarations only in 3.x (census correction); the CSV `comment` column is line hashtag metadata. The compiler multi-file fog graduates to [15-compiler-multi-file-model.md](./15-compiler-multi-file-model.md).
