# Scene System

The scene system provides visual backgrounds and actor images for dialogue scenes.

> 📖 **Detailed Setup Guide**: See [Scenes and Actors Setup](./scenes-actors-setup.md) for complete configuration instructions.

## Quick Overview

Scenes and actors are configured separately in YAML:

```yaml
scenes:
  scene1: https://example.com/background1.jpg
  
actors:
  user: https://example.com/user.png
  Narrator: https://example.com/narrator.png
```

## Features

1. **Background Transitions**: When a scene changes, the background smoothly fades from the old to the new image.
2. **Persistent Backgrounds**: Once a scene is set, the background persists until a new scene is specified.
3. **Actor Images**: Only the speaking actor's image appears at the top center of the scene.
4. **Fallback**: If no scene is specified or an actor has no image, the system falls back to text-only display.

## Using Scenes in Yarn Scripts

Add a `scene:` header to any node:

```yarn
title: Start
scene: scene1
---
Narrator: Welcome to the adventure!
User: Let's begin!
===
```

## Integration

The scene collection is host input — plain data passed to `DialogueRunner` (or, headless, to `DialogueView` alongside a `useDialogue` result):

```tsx
import { DialogueRunner } from "yarn-spinner-runner-ts";
import type { SceneCollection } from "yarn-spinner-runner-ts";

const scenes: SceneCollection = {
  scenes: {
    scene1: {
      background: "/images/street.jpg",
      actors: { Narrator: { image: "/images/narrator.png" } },
    },
  },
};

<DialogueRunner program={program} scenes={scenes} />
```

The package ships no YAML scene parser — if you author scenes in YAML, parse
them host-side (the browser demo keeps a reference parser in
`examples/browser/scenes.ts`). The scene name reaches you on the
`NodeStartEvent`'s `scene` field (and the hook's `sceneName`), so you can
cross-check your collection at that seam: a name with no collection entry
silently keeps the previous background.

## CSS Classes

All dialogue elements use CSS classes prefixed with `yd-`:

- `.yd-scene` - Scene background container
- `.yd-actor` - Actor image (top center)
- `.yd-dialogue-box` - Dialogue box container
- `.yd-text-box` - Text dialogue content
- `.yd-options-box` - Options container

Customize these in your CSS to match your game's style.

