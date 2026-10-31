# Incremental drafting

Represent newly complete meanings promptly on the working slide. Use the compact
pattern index as vocabulary, not a planning checklist. On a blank opening slide, a recognizable topic introduction is sufficient for an
intentional title composition immediately: large title, purposeful alignment,
generous negative space and a restrained visual motif drawn with existing primitives.
An opening should already have visual character; do not defer all composition to Slow.
Use the supplied title pattern without a planning or asset-generation round trip.
Do not wait for the rest of the talk or for Slow. Omit unknown subtitle, author,
date or statistics. A small, polished composition is preferable to raw body text.
For later unresolved relationships, a simple text composition is enough. Preserve useful existing grouping,
IDs and theme. Do not select a new style, rewrite the whole slide or rebuild its
layout on each speech update. Do not add invented headings, metrics or placeholders
merely to complete a recipe. Keep qualifications with the claims they constrain.

A pattern is provisional: later speech may reveal a comparison or process. Make
small local changes within your authorization; leave substantial restructuring
and deck-wide style changes to Slow. This skill does not change host dispatch,
delegation, conflict or navigation rules. Finish when useful additions are complete;
do not produce cosmetic edits solely to satisfy the skill.

A compact supported opening, with the actual spoken topic substituted (not a new
Layout or template to register):

```jsx
<Shape kind="arc" fill="accent" at="br" size="xl" opacity="faint" bleed={true} />
<Stack grow={true} justify="center" gap="lg">
  <Rule color="accent" length="short" weight="bold" />
  <Text role="title">The spoken topic</Text>
</Stack>
```

The arc is an optional example: choose a subject-appropriate supported shape or omit it
when the current style calls for pure typography. Adapt alignment and hierarchy to the topic. Use display text only for a very short
title that fits; ordinary title size is already prominent. Do not invent extra
content to fill negative space.
