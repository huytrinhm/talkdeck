import { chromium, type Browser } from "playwright";
import { AssetStore } from "./assets.js";
import {
  diagnostic,
  type Renderer,
  type Rendered,
  type Diagnostic,
} from "./types.js";
export class ChromiumRenderer implements Renderer {
  private browser?: Browser;
  constructor(
    readonly assets: AssetStore,
    private timeoutMs = 8000,
  ) {}
  async render(source: string): Promise<Rendered> {
    this.browser ??= await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const diagnostics: Diagnostic[] = [];
    // Validate even references in hidden/unused nodes and CSS rules.
    const references: string[] = [];
    for (const m of source.matchAll(
      /(?:src|href|poster|xlink:href)\s*=\s*(["'])(.*?)\1/gi,
    ))
      references.push(m[2]);
    for (const m of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi))
      references.push(m[1]);
    for (const ref of references) {
      if (
        ref &&
        !ref.startsWith("#") &&
        !ref.startsWith("data:") &&
        !this.assets.get(ref)
      )
        diagnostics.push(
          diagnostic("unresolved_reference", `Unregistered reference: ${ref}`),
        );
    }
    for (const script of source.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      if (
        /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(|\.animate\s*\(/.test(
          script[1],
        )
      )
        diagnostics.push(
          diagnostic(
            "non_static_code",
            "Timer-driven or scripted animations are not allowed in published slides. Render final values directly.",
          ),
        );
    }
    page.on("pageerror", (error) =>
      diagnostics.push(diagnostic("execution", error.message)),
    );
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      const asset = this.assets.get(url);
      if (asset)
        await route.fulfill({
          status: 200,
          contentType: asset.mediaType,
          body: asset.data,
        });
      else {
        diagnostics.push(
          diagnostic(
            "unresolved_reference",
            `Unregistered external reference: ${url}`,
          ),
        );
        await route.abort();
      }
    });
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        (async () => {
          // A slide is a static frame: disallow timer-driven number tweening and animations.
          await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
          await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
          await page.setContent(source, {
            waitUntil: "load",
            timeout: this.timeoutMs,
          });
          await page.addStyleTag({
            content:
              "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
          });
          const inspected = await page.evaluate(async () => {
            await document.fonts.ready;
            const diagnostics: {
              code: string;
              severity: "error" | "advisory";
              message: string;
            }[] = [];
            const geometry: {
              scope: string;
              selector: string;
              x: number;
              y: number;
              width: number;
              height: number;
            }[] = [];
            const roots: (Document | ShadowRoot)[] = [document];
            const scopeNames = ["document"];
            for (let n = 0; n < roots.length; n++) {
              const root = roots[n],
                ids = new Set<string>();
              for (const style of root.querySelectorAll("style")) {
                for (const match of (style.textContent ?? "").matchAll(
                  /url\(["']?#([^)'"\s]+)["']?\)/g,
                )) {
                  if (!root.querySelector(`[id="${CSS.escape(match[1])}"]`))
                    diagnostics.push({
                      code: "unresolved_reference",
                      severity: "error",
                      message: `Missing CSS reference #${match[1]}`,
                    });
                }
              }
              for (const el of root.querySelectorAll("*")) {
                const id = el.getAttribute("id");
                if (id && ids.has(id))
                  diagnostics.push({
                    code: "duplicate_id",
                    severity: "error",
                    message: `Duplicate id ${id} in ${scopeNames[n]}`,
                  });
                if (id) ids.add(id);
                if (
                  el.localName.includes("-") &&
                  !customElements.get(el.localName)
                )
                  diagnostics.push({
                    code: "unresolved_component",
                    severity: "error",
                    message: `Unregistered custom element ${el.localName}`,
                  });
                if (el.shadowRoot) {
                  roots.push(el.shadowRoot);
                  scopeNames.push(
                    `${scopeNames[n]}/${el.localName}${id ? "#" + id : ""}`,
                  );
                }
                for (const attr of ["href", "xlink:href", "src"]) {
                  const ref = el.getAttribute(attr);
                  if (
                    ref?.startsWith("#") &&
                    !root.querySelector(`[id="${CSS.escape(ref.slice(1))}"]`)
                  )
                    diagnostics.push({
                      code: "unresolved_reference",
                      severity: "error",
                      message: `Missing fragment ${ref}`,
                    });
                }
                if (
                  el instanceof HTMLImageElement &&
                  (!el.complete || !el.naturalWidth)
                )
                  diagnostics.push({
                    code: "asset",
                    severity: "error",
                    message: `Image failed: ${el.getAttribute("src")}`,
                  });
                for (const attr of el.attributes) {
                  for (const match of attr.value.matchAll(
                    /url\(["']?#([^)'"\s]+)["']?\)/g,
                  )) {
                    if (!root.querySelector(`[id="${CSS.escape(match[1])}"]`))
                      diagnostics.push({
                        code: "unresolved_reference",
                        severity: "error",
                        message: `Missing SVG/CSS reference #${match[1]}`,
                      });
                  }
                }
                const r = el.getBoundingClientRect();
                if (
                  r.width &&
                  r.height &&
                  !["html", "body", "style", "script"].includes(el.localName)
                ) {
                  geometry.push({
                    scope: scopeNames[n],
                    selector: id
                      ? "#" + id
                      : `${el.localName}:nth-of-type(${[...(el.parentElement?.children ?? [])].filter((x) => x.localName === el.localName).indexOf(el) + 1})`,
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                  });
                  if (
                    r.left < -1 ||
                    r.top < -1 ||
                    r.right > 1281 ||
                    r.bottom > 721
                  )
                    diagnostics.push({
                      code: "overflow",
                      severity: "advisory",
                      message: `${el.localName}${id ? "#" + id : ""} extends outside the slide`,
                    });
                }
              }
            }
            return { geometry, diagnostics };
          });
          diagnostics.push(...inspected.diagnostics);
          const screenshot = await page.screenshot({
            type: "png",
            animations: "disabled",
            timeout: this.timeoutMs,
          });
          return { screenshot, geometry: inspected.geometry, diagnostics };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Slide render exceeded deadline")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
      await context.close();
    }
  }
  async close() {
    await this.browser?.close();
  }
}
