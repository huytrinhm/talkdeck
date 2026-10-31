import type { DeckDocument } from './contracts.js';

/** Source-valid seed. Rendering readiness still requires the real validation pipeline. */
export function createDeck(): DeckDocument {
  return { schemaVersion: 1, source: `<Deck id="n1" version={1}>
  <Brief id="n2" />
  <Theme id="n3">
    <Token id="n4" name="--color-bg" value="#fafafa" />
    <Token id="n5" name="--color-fg" value="#18181b" />
    <Token id="n6" name="--color-accent" value="#0f766e" />
    <Token id="n7" name="--color-accent-fg" value="#ffffff" />
    <Scale id="n8" text={{ title: 88, subtitle: 44, heading: 56, body: 32, caption: 24, label: 20, stat: 128, hero: 220, quote: 56, display: 200, numeral: 160, lead: 40 }} space={{ xs: 12, sm: 24, md: 40, lg: 64, xl: 96 }} />
  </Theme>
  <Library id="n9" />
  <Slide id="n10" version={1} freeForm={{ reason: 'Initial composition' }}>
    <Transcript id="n11" />
    <SpeakerNotes id="n12" />
  </Slide>
  <Archive id="n13" />
</Deck>` };
}
