/** Live Flare + deterministic specialist choreography + real Chromium integration. */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clientFromEnv } from "./config.js";
import { AssetStore } from "./assets.js";
import { FileLog } from "./log.js";
import { ChromiumRenderer } from "./renderer.js";
import { SlideRuntime } from "./runtime.js";
import type { ModelResult } from "./types.js";
const output = resolve(
  process.env.RUN_DIR ??
    `runs/assets-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const log = new FileLog(output),
  assets = new AssetStore(join(output, "assets"));
const call = (name: string, args: unknown): ModelResult => ({
  output: [
    {
      type: "function_call",
      name,
      arguments: JSON.stringify(args),
      call_id: crypto.randomUUID(),
    },
  ],
});
const counts = new Map<string, number>(),
  kinds = new Map<string, "image" | "component">();
let assigned = 0,
  integrated = false;
let runtime: SlideRuntime;
const component =
  '<script>customElements.define("trial-metric",class extends HTMLElement{connectedCallback(){this.attachShadow({mode:"open"}).innerHTML=`<style>:host{display:block;padding:24px;border:1px solid #bbcabd;border-radius:18px;background:#edf4ed;font:20px Arial;color:#193627}strong{display:block;font-size:52px;margin:8px 0}</style><span>Trial completers</span><strong>48</strong><span>60 students signed up</span>`;}});</script><trial-metric></trial-metric>';
runtime = await SlideRuntime.create({
  client: clientFromEnv(),
  assets,
  log,
  renderer: new ChromiumRenderer(assets),
  autoTick: false,
  decider: {
    async evaluate() {
      return "hold";
    },
  },
  slowDecider: {
    async evaluate() {
      return "hold";
    },
  },
  model: {
    async infer(input) {
      const count = (counts.get(input.agent) ?? 0) + 1;
      counts.set(input.agent, count);
      if (input.role === "slow") {
        if (count === 1)
          return call("delegate", {
            task: "Generate a warm editorial library locker illustration",
            facts: "No text or statistics in the image",
            slideId: null,
          });
        if (count === 2)
          return call("delegate", {
            task: "Create a registered custom metric component",
            facts: "48 completed; 60 signed up",
            slideId: null,
          });
        const image = assets
          .refs()
          .find((ref) => assets.get(ref)?.mediaType === "image/png");
        if (
          image &&
          assets
            .refs()
            .some((ref) => assets.get(ref)?.mediaType === "text/html") &&
          !integrated
        ) {
          integrated = true;
          return call("edit", {
            slideId: runtime.publisher.selectedId,
            old: runtime.publisher.current.source,
            new: `<!doctype html><html><head><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f8f5ed;color:#193627;font-family:Arial}main{padding:48px;display:grid;grid-template-columns:1.1fr 1fr;gap:40px}h1{font-size:48px;line-height:1.1;margin:12px 0 28px}p{font-size:24px;line-height:1.4}img{width:100%;height:560px;object-fit:cover;border-radius:24px}</style></head><body><main><section><p>FICTIONAL CAMPUS PILOT</p><h1>Reserve online.<br>Pick up between classes.</h1>${component}<p>Private specialist image + registered component, integrated only by Slow.</p></section><img src="${image}"></main></body></html>`,
          });
        }
        return { output: [] };
      }
      if (!kinds.has(input.agent))
        kinds.set(input.agent, assigned++ === 0 ? "image" : "component");
      if (count === 1)
        return kinds.get(input.agent) === "image"
          ? call("image_generate", {
              prompt:
                "Architectural editorial illustration of self-service book pickup lockers inside a welcoming university library. Warm daylight, muted forest green and cream palette, bookshelves in background, clean uncluttered composition. No people, no logos, no lettering, no charts or numbers.",
              quality: "low",
              size: "1536x1024",
            })
          : call("save_artifact", {
              mediaType: "text/html",
              content: component,
            });
      return { output: [] };
    },
  },
});
let failure: unknown;
try {
  runtime.followupTask("slow", {
    task: "Prepare both private assets and integrate them",
    facts: "",
  });
  await runtime.settle(240000);
  if (!integrated || !runtime.publisher.current.source.includes("trial-metric"))
    throw new Error("Assets were not integrated");
} catch (e) {
  failure = e;
} finally {
  writeFileSync(join(output, "final.html"), runtime.publisher.current.source);
  writeFileSync(
    join(output, "final.png"),
    runtime.publisher.current.screenshot,
  );
  const summary = {
    output,
    model: "gpt-image-2.5-flare",
    deterministicChoreography: true,
    integrated,
    assets: assets
      .refs()
      .map((ref) => ({ ref, mediaType: assets.get(ref)!.mediaType })),
    diagnostics: runtime.publisher.current.diagnostics,
    statuses: runtime.statuses(),
    error: failure instanceof Error ? failure.message : failure,
  };
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  await runtime.close();
}
if (failure) process.exitCode = 1;
