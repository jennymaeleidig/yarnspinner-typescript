## Typing Animation (React)

The demo UI ships with a `TypingText` React component that renders dialogue one character at a time. `DialogueView` stitches this into `Dialogue` so you can opt into typewriter-style delivery without touching lower-level runtime code.

### Enabling the effect

- Toggle the animation with the `enableTypingAnimation` prop on `DialogueView`.
- When enabled, text is revealed via `TypingText`; when disabled, full lines render immediately.
- Example:

```tsx
<DialogueView
  program={program}
  enableTypingAnimation={true}
  typingSpeed={45}
/>
```

### Core props

- `typingSpeed` (ms delay between characters): lower is faster; `0` renders instantly.
- `showTypingCursor`: toggles the flashing cursor.
- `cursorCharacter`: replace the default `|` cursor.
- `autoContinueAfterTyping`: auto-continue once typing completes.
- `autoContinueDelay`: wait time (ms) before auto-continuing.
- `pauseBeforeContinue`: optional delay (ms) when the player taps to continue after typing finishes.

### Interaction details

- Clicking while text is mid-animation skips straight to the full line; a second click continues to the next view state.
- The `onComplete` callback fires exactly once when the last character is revealed (or immediately if typing is disabled), making it safe to trigger auto-continue.
- The "continue" glyph (`yd-continue`) is suppressed whenever typing is active so players are not prompted to continue until the full line appears.
- When you disable typing in `DialogueExample`, `pauseBeforeContinue` automatically falls back to `0` so clicks continue instantly.

### Styling

- `TypingText` accepts `className` and `cursorClassName` for theming.
- Cursor blinking speed is controlled by `cursorBlinkDuration` (ms).

### Testing

- The animation behaviour is covered by `dist/tests/typing-text.test.js`. Re-run `npm test` after tweaks to catch regressions in cursor visibility, skip handling, and completion callbacks.
