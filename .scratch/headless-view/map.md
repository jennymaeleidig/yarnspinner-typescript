# Wayfinder map — headless-view (deepening-wave ticket 06 deferral)

The deepening wave (`.scratch/deepening-wave/`) resolved tickets 01–09; its
ticket 06 explicitly **deferred** the headless `DialogueView` split to its
own design-it-twice pass. That deferral is worked here.

| Ticket                                                        | Status  | Depends on |
| ------------------------------------------------------------- | ------- | ---------- |
| [01 headless DialogueView: presentational over the result](issues/01-headless-dialogue-view.md) | resolved | deepening-wave 04, 05, 06 |

## Decisions so far

- [01 headless DialogueView](issues/01-headless-dialogue-view.md): the split
  landed as designed — presentational `DialogueView` takes a
  `UseDialogueResult` and owns **presentation state only** (typing progress,
  skip, the one continue scheduler); the new `DialogueRunner` container owns
  the program/config/live wiring and the deprecated alias names. Recorded in
  the ticket's Answer.
