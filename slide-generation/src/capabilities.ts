/** Implementation availability, never a substitute for per-document validation. */
export function capabilities() {
  return {
    parser: true, schema: true, expander: false, renderer: false,
    browser: false, assets: false, icons: false, commit: false, liveHost: false,
    mutationsReady: false,
  } as const;
}
