---
name: stylus-performance
description: Jami notebook drawing, Apple Pencil, pointer events, stroke rendering, smoothing, latency, palm rejection, and saved ink compatibility. Use whenever editing or debugging the notebook drawing system.
argument-hint: [drawing problem or requested change]
---

# Jami Stylus Performance

Apply this skill to:

$ARGUMENTS

Before editing, trace:

1. Pointer event collection
2. Pointer capture and cancellation
3. Coalesced or predicted events, if used
4. Active-stroke state updates
5. Stroke interpolation and smoothing
6. Canvas or SVG rendering
7. Persistence and reload normalisation
8. Touch scrolling and palm rejection

## Requirements

- Prioritise low visible latency during an active stroke.
- Do not wait for database writes before rendering ink.
- Avoid React rerenders for every raw pointer event where possible.
- Preserve the existing saved stroke format unless a migration is justified.
- Keep old notebooks readable.
- Handle `pointerup`, `pointercancel`, lost capture, and interrupted strokes.
- Do not break touch scrolling, zooming, erasing, highlighting, or selection.
- Avoid excessive allocations in high-frequency pointer handlers.
- Keep smoothing stable without making ink visibly trail the Pencil.
- Test rapid strokes, dots, sharp corners, long strokes, erasing, and switching tools.
- Check desktop mouse, touchscreen, and Apple Pencil behaviour separately.

When proposing an optimisation, explain whether it improves:

- Input collection latency
- Rendering latency
- React update overhead
- Stroke quality
- Persistence performance

Measure or profile before making broad performance rewrites whenever possible.
