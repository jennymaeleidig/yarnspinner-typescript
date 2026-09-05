# Scene System

The scene system delivers the `scene:` header of each node to your host;
backgrounds and actor images are your UI's presentation over that name.

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

The package ships no YAML scene parser — parsing and presentation are
host-owned. What the runtime delivers is the name, on one channel:

- The node's `scene:` header arrives on the `NodeStartEvent`'s `scene` field.
- `Transcript.scene` carries the most recently started node's scene forward
  across scene-less nodes.

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

The scene collection is host input — plain data you parse, validate, and key
your presentation on:

```ts
import type { SceneCollection } from "yarn-spinner-runner-ts";

const scenes: SceneCollection = {
  scenes: {
    scene1: {
      background: "/images/street.jpg",
      actors: { Narrator: { image: "/images/narrator.png" } },
    },
  },
};
```

The scene name reaches you on the `NodeStartEvent`'s `scene` field (and
`Transcript.scene`, carried forward across scene-less nodes), so you can
cross-check your collection at that seam: a name with no collection entry
means your host decides what to show.
