# Incremental drafting

An opening requires an actual named subject. Greetings and unfinished preambles
("Alright, today we are presenting about…", "Hôm nay chúng ta sẽ nói về…")
are not titles. Leave the slide unchanged until the subject arrives, even if the
host dispatched that fragment. Strip conversational setup from visible headings;
retain the original speech as evidence/notes.

Represent newly complete meanings promptly on the working slide. Use the compact
pattern index as vocabulary, not a planning checklist. On a blank opening slide, a recognizable topic introduction is sufficient for an
intentional title composition immediately: large title, purposeful alignment,
generous negative space and a restrained visual motif drawn with existing primitives.
An opening should already have visual character; do not defer all composition to Slow.
Use the supplied title pattern without a planning or asset-generation round trip.
Do not wait for the rest of the talk or for Slow. Omit unknown subtitle, author,
date or statistics. A small, polished composition is preferable to raw body text.
Every new slide starts with editable visual scaffolding, not a blank canvas:
a short accent rule and full-height Stack, ready for a subject-specific motif or image. Add the title inside that
Stack. For content slides, adapt the starter into a comparison, process, grouped
explanation or image-led composition as soon as the spoken relationship is clear.
Keep its useful IDs and the deck theme; removing or reshaping the starter is allowed.

Be decisive about local design. Use contrast, hierarchy, purposeful asymmetry,
shapes and available imagery when they serve the subject. A polished first frame
is part of Fast's responsibility. You may reorganize the working slide in the same
transaction as new content. Preserve intentional design; do not preserve an
accidentally plain draft merely because it already exists. Avoid rebuilding on
every word or making cosmetic edits once the slide communicates well. Do not add invented headings, metrics or placeholders
merely to complete a recipe. Keep qualifications with the claims they constrain.

A pattern is provisional: later speech may reveal a comparison or process. Make
purposeful local changes within your authorization; leave cross-slide restructuring
and deck-wide theme changes to Slow. This skill does not change host dispatch,
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
