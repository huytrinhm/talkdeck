import test from "node:test";
import assert from "node:assert/strict";
import { AssetStore } from "../../src/orchestration/assets.js";
import { ChromiumRenderer } from "../../src/orchestration/renderer.js";
import { blankSlide } from "../../src/orchestration/types.js";
test("Chromium renders image/geometry and rejects unresolved references, components, duplicate IDs and execution failures", async () => {
  const assets = new AssetStore(),
    renderer = new ChromiumRenderer(assets);
  try {
    const valid = await renderer.render(blankSlide);
    assert(valid.screenshot.length > 1000);
    assert(valid.geometry.length > 0);
    assert.equal(
      valid.diagnostics.filter((x) => x.severity === "error").length,
      0,
    );
    const bad = await renderer.render(
      '<html><body><div id="a"></div><div id="a"></div><missing-widget></missing-widget><img src="https://missing.invalid/image.png"><svg><use href="#absent"/></svg><script>throw new Error("broken")</script></body></html>',
    );
    for (const code of [
      "duplicate_id",
      "unresolved_component",
      "unresolved_reference",
      "execution",
    ])
      assert(
        bad.diagnostics.some((d) => d.code === code),
        code,
      );
    const ref = assets.put(
      "image/svg+xml",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="20"/></svg>',
      ),
    );
    const good = await renderer.render(
      `<html><body><img src="${ref}"><x-card></x-card><script>customElements.define('x-card',class extends HTMLElement{connectedCallback(){this.attachShadow({mode:'open'}).innerHTML='<b id="a">Hello</b>'}})</script><b id="a">World</b></body></html>`,
    );
    assert.equal(
      good.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    assert(good.geometry.some((g) => g.scope.includes("x-card")));
  } finally {
    await renderer.close();
  }
});
test("hidden external references, missing CSS fragments and numeric timer animations are rejected", async () => {
  const r = new ChromiumRenderer(new AssetStore());
  try {
    const result = await r.render(
      '<html><head><style>.unused{filter:url(#missing)}</style></head><body><a href="https://outside.invalid">link</a><script>setInterval(()=>document.body.textContent=Math.random(),10)</script></body></html>',
    );
    assert(result.diagnostics.some((d) => d.code === "unresolved_reference"));
    assert(result.diagnostics.some((d) => d.code === "non_static_code"));
  } finally {
    await r.close();
  }
});
