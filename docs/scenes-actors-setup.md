# Scene and Actor Setup Guide

This guide explains how to configure scenes and actors for the dialogue system.

## Overview

Scenes provide visual backgrounds and actor images for dialogue. Actors are characters that appear when they speak. The configuration uses YAML format with two separate sections: `scenes` and `actors`.

## Configuration Format

Create a YAML file with the following structure:

```yaml
scenes:
  scene1: https://example.com/background1.jpg
  scene2: https://example.com/background2.jpg
  
actors:
  user: https://example.com/user.png
  Narrator: https://example.com/narrator.png
  npc: https://example.com/npc.png
```

## Scenes

### Simple Scene (Background Only)

The simplest format is just the background image URL:

```yaml
scenes:
  scene1: https://example.com/background1.jpg
```

This creates a scene named `scene1` with the specified background. All global actors will be available in this scene.

### Scene with Custom Actors

You can override global actors per scene:

```yaml
scenes:
  scene1:
    background: https://example.com/background1.jpg
    actors:
      special_npc:
        image: https://example.com/special-npc.png
```

This creates `scene1` with a custom background and includes a scene-specific actor `special_npc` in addition to all global actors.

### Scene Structure

- **scene name** (key): The identifier used in Yarn scripts (e.g., `scene: scene1`)
- **background** (string): URL or path to the background image
- **actors** (object, optional): Scene-specific actors that override or extend global actors

## Actors

### Global Actors

Global actors are available in all scenes:

```yaml
actors:
  user: https://example.com/user.png
  Narrator: https://example.com/narrator.png
  npc: https://example.com/npc.png
```

### Actor Configuration

Actors can be defined in two ways:

**Shorthand** (direct URL):
```yaml
actors:
  user: https://example.com/user.png
```

**Full format** (object):
```yaml
actors:
  user:
    image: https://example.com/user.png
```

Both formats are equivalent. The object format allows for future extension with additional actor properties.

## Using Scenes in Yarn Scripts

Add a `scene:` header to any node to activate that scene:

```yarn
title: Start
scene: scene1
---
Narrator: Welcome to the adventure!
User: Let's begin!
===
```

### Scene Persistence

Once a scene is set, the background persists across nodes until a new scene is specified. If a node doesn't have a `scene:` header, the previous scene continues to be used.

## Actor Display

The package ships no scene parser and no rendering — presentation is
host-owned. What follows is a suggested host convention (the browser demo
works this way), not built-in behavior:

### When Actors Appear (suggested convention)

- Show actors only when they are speaking
- Match actor images by name (case-insensitively)
- Place the speaking actor's image at the top center of the scene
- If no matching actor is found in the scene configuration, show only the text
- Portrait transitions (if your UI shows actors at all) are a presentation
  choice: pick a duration and drive it from your own CSS or component code.

### Actor Matching (suggested convention)

A host can match actor names in the Yarn script against actor names in the scene configuration — for example, case-insensitively:

```yarn
Narrator: This is the narrator speaking.
```

Under that convention, this matches an actor named `Narrator`, `narrator`, or any case variation in your scene config.

## Example Configuration

```yaml
scenes:
  intro:
    background: /assets/backgrounds/intro.jpg
  forest:
    background: /assets/backgrounds/forest.jpg
    actors:
      guide:
        image: /assets/actors/guide.png
  
actors:
  user: /assets/actors/user.png
  Narrator: /assets/actors/narrator.png
  merchant: /assets/actors/merchant.png
```

In this example:
- `intro` scene uses the intro background and all global actors (user, Narrator, merchant)
- `forest` scene uses the forest background, includes all global actors, plus a scene-specific `guide` actor

## Yarn Script Example

```yarn
title: Intro
scene: intro
---
Narrator: Welcome to the adventure!
User: I'm ready to begin!
===

title: Forest
scene: forest
---
Narrator: You enter the mysterious forest.
Guide: Let me show you the way.
User: Thank you, guide!
===
```

## Image Requirements

- **Background images**: Should be high resolution (recommended: 1920x1080 or higher) as they fill the entire scene
- **Actor images**: Should be transparent PNGs with the character visible in the frame (recommended: 800x1200 or similar portrait aspect)
- Images can be:
  - Local paths: `/assets/images/character.png`
  - Absolute URLs: `https://example.com/image.jpg`
  - Relative URLs: `../images/background.png`

## CSS Styling

The package ships no stylesheet and no CSS class convention — presentation is
host-owned. The browser demo's `examples/browser/dialogue.css` is one
example of styling a plain-text UI; write your own to match your game.

## Tips

1. **Reuse actors**: Define common actors globally so they're available in all scenes
2. **Scene-specific actors**: Use scene-specific actors for characters that only appear in certain scenes
3. **Background persistence**: Scenes persist until changed, so you don't need to repeat `scene:` in every node
4. **Case sensitivity**: if you follow the suggested matching convention, actor names match case-insensitively; treat scene names as case-sensitive
5. **Image loading**: Use optimized images (WebP or compressed PNG/JPG) for better performance

