import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSpeechSafety } from "./safety";
/** HTTP fixture only. Actual server ownership/crypto/CAS is verified by hosting tests. */
function serviceFixture() {
  const keys = new Map<string, { validation: string }>(),
    pairs = new Map<string, any>();
  let counter = 0,
    checks = 0;
  async function bind(context: BrowserContext, visitor: string) {
    await context.route("**/api.openai.com/**", (route) => route.abort());
    await context.route("**/api/connections**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname.slice("/api/connections".length),
        method = req.method();
      const reply = (
        value: unknown,
        status = 200,
        headers: Record<string, string> = {},
      ) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store", ...headers },
          body: JSON.stringify(value),
        });
      const fail = (code: string, status = 400) =>
        reply({ error: { code } }, status);
      const expiresAt = Date.now() + 600000,
        sessionExpiresAt = Date.now() + 3600000;
      if (path === "" && method === "GET")
        return reply({
          version: 1,
          session: { ready: true, expiresAt: sessionExpiresAt },
          phone: {
            available: true,
            transport: "webrtc",
            media: "raw-audio",
            network: "same-network",
            iceServers: [],
          },
          key: { available: true, configured: keys.has(visitor) },
        });
      if (method !== "GET" && req.headers().origin !== url.origin)
        return fail("origin_rejected", 403);
      if (path === "/session")
        return reply(
          { csrfToken: "fixture-" + visitor, expiresAt: sessionExpiresAt },
          200,
          {
            "Set-Cookie": `fixture_session=${visitor}; HttpOnly; Secure; SameSite=Strict; Path=/`,
          },
        );
      if (
        method !== "GET" &&
        req.headers()["x-csrf-token"] !== "fixture-" + visitor
      )
        return fail("csrf_rejected", 403);
      if (path === "/key") {
        if (method === "GET")
          return reply({
            configured: keys.has(visitor),
            validation: keys.get(visitor)?.validation,
            expiresAt: sessionExpiresAt,
          });
        if (method === "POST") {
          const body = req.postDataJSON();
          if (typeof body.key !== "string") return fail("invalid_key_format");
          keys.set(visitor, { validation: "not-checked" });
          return reply({
            configured: true,
            validation: "not-checked",
            expiresAt: sessionExpiresAt,
          });
        }
        if (method === "DELETE") {
          keys.delete(visitor);
          return reply({ configured: false });
        }
      }
      if (path === "/key/verify") {
        if (!keys.has(visitor)) return fail("key_required");
        checks++;
        keys.set(visitor, { validation: "verified" });
        return reply({
          configured: true,
          validation: "verified",
          verifiedAt: Date.now(),
          expiresAt: sessionExpiresAt,
        });
      }
      if (path === "/pairings" && method === "POST") {
        const id = String(++counter).padStart(22, "A"),
          code = id + "." + "B".repeat(43),
          offer = req.postDataJSON().offer;
        pairs.set(id, {
          owner: visitor,
          offer,
          code,
          expiresAt,
          sessionExpiresAt,
        });
        return reply({
          pairingId: id,
          code,
          qrUrl: url.origin + "/client/#phone?pair=" + code,
          expiresAt,
          sessionExpiresAt,
        });
      }
      const parts = path.split("/"),
        pair = pairs.get(parts[2]);
      if (!pair) return fail("not_found", 404);
      if (parts[3] === "claim") {
        if (req.postDataJSON().code !== pair.code)
          return fail("invalid_request");
        if (pair.phone && pair.phone !== visitor)
          return fail("pairing_claimed", 409);
        pair.phone = visitor;
        return reply({
          offer: pair.offer,
          expiresAt: pair.expiresAt,
          sessionExpiresAt,
        });
      }
      if (visitor !== pair.owner && visitor !== pair.phone)
        return fail("not_found", 404);
      if (parts[3] === "answer") {
        if (visitor !== pair.phone) return fail("not_found", 404);
        pair.answer = req.postDataJSON().answer;
        return reply({ state: "answered", expiresAt: pair.expiresAt });
      }
      if (method === "DELETE") {
        pairs.delete(parts[2]);
        return reply({ revoked: true });
      }
      return reply({
        state: pair.answer ? "answered" : pair.phone ? "claimed" : "offered",
        answer: visitor === pair.owner ? pair.answer : undefined,
        expiresAt: pair.expiresAt,
        sessionExpiresAt,
      });
    });
  }
  return {
    bind,
    get checks() {
      return checks;
    },
  };
}
async function project(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
}
test("@adapter-fixture actual WebRTC carries synthetic raw audio between isolated desktop/phone visitors with explicit capture and cleanup", async ({
  browser,
}) => {
  test.setTimeout(45000);
  const service = serviceFixture(),
    desktopContext = await browser.newContext(),
    phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  await service.bind(desktopContext, "desktop");
  await service.bind(phoneContext, "phone");
  const desktop = await desktopContext.newPage(),
    phone = await phoneContext.newPage();
  await installSpeechSafety(desktop, true);
  await installSpeechSafety(phone, true);
  const errors: string[] = [];
  desktop.on("pageerror", (e) => errors.push(e.message));
  phone.on("pageerror", (e) => errors.push(e.message));
  try {
    await project(desktop);
    await desktop
      .getByRole("button", { name: "Connect phone", exact: true })
      .click();
    await desktop
      .getByText("Use a pairing code instead", { exact: true })
      .click();
    const code = await desktop
      .getByLabel("Pairing code", { exact: true })
      .inputValue();
    await phone.goto("/client/#phone?pair=" + code);
    await expect(phone).toHaveURL(/#phone$/);
    await expect(
      phone.getByRole("button", { name: "Start microphone" }),
    ).toBeDisabled();
    expect(
      await phone.evaluate(() => (window as any).__rawMediaCalls ?? 0),
    ).toBe(0);
    await phone
      .getByRole("button", { name: "Connect to presentation", exact: true })
      .click();
    await expect(
      phone.getByRole("button", { name: "Start microphone" }),
    ).toBeEnabled();
    await expect(
      desktop.getByRole("button", { name: "Phone", exact: true }),
    ).toBeEnabled();
    await desktop.getByRole("button", { name: "Phone", exact: true }).click();
    expect(
      await desktop.evaluate(() => (window as any).__rawMediaCalls ?? 0),
    ).toBe(0);
    expect(
      await phone.evaluate(() => (window as any).__rawMediaCalls ?? 0),
    ).toBe(0);
    await phone.getByRole("button", { name: "Start microphone" }).click();
    await expect(
      phone.getByText("Microphone on", { exact: true }),
    ).toBeVisible();
    await expect(
      desktop.getByText("Receiving audio", { exact: true }),
    ).toBeVisible();
    const media = await desktop.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => n.includes("/src/services/phoneVoice.ts"))
        .at(-1)!;
      const { phoneVoice } = await import(/* @vite-ignore */ url);
      const track = phoneVoice.getRemoteStream()?.getAudioTracks()[0];
      return {
        kind: track?.kind,
        state: track?.readyState,
        muted: track?.muted,
        processing: phoneVoice.getSnapshot().processingAvailable,
      };
    });
    expect(media).toEqual({
      kind: "audio",
      state: "live",
      muted: false,
      processing: false,
    });
    await desktop.screenshot({
      path: "docs/main-ui-report/capture-assets/p0-raw-audio-received-fixture.png",
    });
    await phone.screenshot({
      path: "docs/main-ui-report/capture-assets/p0-raw-phone-capturing-fixture-390.png",
    });
    await phone
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    await expect(
      phone.getByText("Microphone muted", { exact: true }),
    ).toBeVisible();
    await expect(desktop.getByText("Mic muted", { exact: true })).toBeVisible();
    await phone
      .getByRole("button", { name: "Unmute microphone", exact: true })
      .click();
    await expect(
      desktop.getByText("Receiving audio", { exact: true }),
    ).toBeVisible();
    await desktop
      .getByRole("button", { name: "Back to presentation", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "Talk to generate", exact: true })
      .click();
    await expect(
      desktop.getByText(
        "Phone audio received. Speech processing is not connected.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await desktop.evaluate(() => (window as any).__rawMediaCalls ?? 0),
    ).toBe(0);
    await desktop
      .getByRole("button", { name: "App settings", exact: true })
      .click();
    await expect(
      phone.getByText("Microphone off", { exact: true }),
    ).toBeVisible();
    expect(
      await phone.evaluate(
        () => (window as any).__rawMediaStream.getAudioTracks()[0].readyState,
      ),
    ).toBe("ended");
    await desktop
      .getByRole("button", { name: "Back to presentation", exact: true })
      .click();
    expect(await phone.evaluate(() => (window as any).__rawMediaCalls)).toBe(1);
    await desktop
      .getByRole("button", { name: "App settings", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "Disconnect phone", exact: true })
      .click();
    await expect(
      phone.getByRole("status").filter({ hasText: /^Disconnected/ }),
    ).toBeVisible();
    expect(await phone.locator("audio,video").count()).toBe(0);
    expect(errors).toEqual([]);
  } catch (error) {
    const diagnostic = await desktop.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => n.includes("/src/services/phoneVoice.ts"))
        .at(-1)!;
      const { phoneVoice } = await import(/* @vite-ignore */ url);
      const state = phoneVoice.getSnapshot(),
        track = phoneVoice.getRemoteStream()?.getAudioTracks()[0],
        reports = await (phoneVoice as any).port?.peer?.getStats();
      let packets = 0;
      reports?.forEach((r: any) => {
        if (r.type === "inbound-rtp" && r.kind === "audio")
          packets += r.packetsReceived ?? 0;
      });
      return {
        status: state.status,
        capturing: state.capturing,
        receiving: state.receivingAudio,
        active: state.active,
        track: track
          ? { kind: track.kind, muted: track.muted, state: track.readyState }
          : null,
        packets,
      };
    });
    console.log("synthetic raw diagnostic", diagnostic);
    throw error;
  } finally {
    await desktopContext.close();
    await phoneContext.close();
  }
});
test("@adapter-fixture anonymous BYOK uses actual HTTP/CSRF adapter with isolated storage/check/remove acknowledgements and no secret persistence", async ({
  browser,
}) => {
  const service = serviceFixture(),
    one = await browser.newContext(),
    two = await browser.newContext();
  await service.bind(one, "one");
  await service.bind(two, "two");
  const page = await one.newPage(),
    other = await two.newPage();
  await installSpeechSafety(page);
  await installSpeechSafety(other);
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "App settings", exact: true })
      .click();
    const input = page.getByLabel("OpenAI API key", { exact: true });
    await expect(input).toBeEnabled();
    await input.fill("fixture-value-not-a-real-credential");
    await expect(input).toHaveAttribute("type", "password");
    await page
      .getByRole("button", { name: "Save for session", exact: true })
      .click();
    await expect(input).toHaveCount(0);
    await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
    expect(service.checks).toBe(0);
    await page.getByRole("button", { name: "Check key", exact: true }).click();
    await expect(page.getByText("Key verified", { exact: true })).toBeVisible();
    expect(service.checks).toBe(1);
    await page.screenshot({
      path: "docs/main-ui-report/capture-assets/p0-byok-verified-http-fixture.png",
    });
    expect(page.url()).not.toContain("fixture-value");
    expect(
      await page.evaluate(() =>
        JSON.stringify(localStorage).includes("fixture-value"),
      ),
    ).toBe(false);
    await other.goto("/");
    await other
      .getByRole("button", { name: "App settings", exact: true })
      .click();
    await expect(
      other.getByLabel("OpenAI API key", { exact: true }),
    ).toBeEnabled();
    await expect(other.getByText("Key verified", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Remove key", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByText("Key verified", { exact: true })).toHaveCount(
      0,
    );
    expect(service.checks).toBe(1);
  } finally {
    await one.close();
    await two.close();
  }
});
