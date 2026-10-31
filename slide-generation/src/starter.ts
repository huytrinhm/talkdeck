/** Editable visual scaffold, with no invented audience content or visible placeholders. */
export function starterComposition(ids?: { body: string; rule: string }) {
  const id = (key: keyof NonNullable<typeof ids>) => ids ? ` id="${ids[key]}"` : '';
  return `    <Stack${id('body')} grow={true} justify="center" gap="lg">
      <Rule${id('rule')} color="accent" length="short" weight="bold" />
    </Stack>`;
}
