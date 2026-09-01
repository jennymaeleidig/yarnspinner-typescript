# 51: CSV module + tagLines + setLanguage

**What to build:** hosts can localise — read and write upstream 8-column CSV strings files (`language,id,text,file,node,lineNumber,lock,comment`; `lock` = first 8 hex SHA-256 of base text; `comment` = hashtag metadata), generate line tags via a pluggable seam with Random (default) and Descriptive built-ins and the `tagLines(source, {generator})` utility, and switch runtime language with a CSV-backed provider over the injectable text-provider seam (`setLanguage`). No `.yarnproject` equivalent.

**Blocked by:** 50 (string table + line IDs are the CSV keys).

**Status:** ready-for-agent

- [ ] Ported inline CSV tests green (no fixture coverage — inventory fact)
- [ ] tagLines round-trips with both built-in generators
- [ ] setLanguage swaps rendered text from a CSV strings file
- [ ] Full suite green
