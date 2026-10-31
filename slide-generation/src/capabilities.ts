export interface CapabilityBindings {
  renderer?: boolean;
  browser?: boolean;
  assets?: boolean;
  icons?: boolean;
  commit?: boolean;
  /** Compatibility mirror of engine state; not presentation readiness. */
  mutationsReady?: boolean;
}
/** Bound implementation availability, never a substitute for per-document checks. */
export function capabilities(bindings: CapabilityBindings = {}) {
  return {
    parser: true, schema: true, expander: true,
    renderer: bindings.renderer === true,
    browser: bindings.browser === true,
    assets: bindings.assets === true,
    icons: bindings.icons === true,
    commit: bindings.commit === true,
    // A subsystem runtime is not the neighboring orchestration actor host.
    liveHost: false,
    mutationsReady: bindings.mutationsReady === true,
  } as const;
}
