import { it, expect, vi } from "vitest";
import {
  PersonalApiKeyController,
  ApiKeyFailure,
  type PersonalApiKeyPort,
} from "./personalApiKey";
const fixture = "fixture-value-not-a-real-credential";
const port = (): PersonalApiKeyPort => ({
  available: true,
  getStatus: async () => ({ configured: false }),
  save: async () => ({ configured: true }),
  remove: async () => ({ configured: false }),
});
it("does not accept a key or report validation when capability is unavailable", async () => {
  const c = new PersonalApiKeyController();
  await c.save(fixture);
  expect(c.getSnapshot().available).toBe(false);
  expect(c.getSnapshot().configured).toBe(false);
  expect(c.getSnapshot().phase).toBe("unavailable");
});
it("requires service acknowledgment for save/remove and never exposes a key in snapshots", async () => {
  const p = port(),
    c = new PersonalApiKeyController();
  await c.configure(p);
  let done!: (value: { configured: true }) => void;
  p.save = () =>
    new Promise((resolve) => {
      done = resolve;
    });
  const work = c.save(fixture);
  expect(c.getSnapshot().phase).toBe("saving");
  expect(c.getSnapshot().configured).toBe(false);
  expect(JSON.stringify(c.getSnapshot())).not.toContain(fixture);
  done({ configured: true });
  await work;
  expect(c.getSnapshot().configured).toBe(true);
  await c.remove();
  expect(c.getSnapshot().configured).toBe(false);
});
it("shows only controlled error codes without exposing service error content", async () => {
  const p = port(),
    c = new PersonalApiKeyController();
  await c.configure(p);
  p.save = async () => {
    throw new Error(fixture);
  };
  await c.save(fixture);
  expect(c.getSnapshot().error).toBe("unknown");
  expect(JSON.stringify(c.getSnapshot())).not.toContain(fixture);
  await c.refresh();
  p.save = async () => {
    throw new ApiKeyFailure("invalid-key");
  };
  await c.save(fixture);
  expect(c.getSnapshot().error).toBe("invalid-key");
});
it("keeps stored and provider-verified facts separate and verifies only on explicit action", async () => {
  const verify = vi.fn(async () => ({
    configured: true as const,
    validation: "verified" as const,
  }));
  const c = new PersonalApiKeyController();
  await c.configure({
    available: true,
    verifiesKey: false,
    getStatus: async () => ({ configured: false }),
    save: async () => ({ configured: true, validation: "not-checked" }),
    remove: async () => ({ configured: false }),
    verify,
  });
  await c.save("fixture");
  expect(c.getSnapshot().validation).toBe("not-checked");
  expect(verify).not.toHaveBeenCalled();
  await c.verify();
  expect(verify).toHaveBeenCalledOnce();
  expect(c.getSnapshot().validation).toBe("verified");
  await c.remove();
  expect(c.getSnapshot().validation).toBe("not-checked");
});
it("lets a pending replacement own its acknowledgement across expiry without unlocking a second mutation", async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (v: any) => void;
    const c = new PersonalApiKeyController();
    await c.configure({
      available: true,
      getStatus: async () => ({
        configured: true,
        expiresAt: Date.now() + 1000,
      }),
      save: () => new Promise((r) => (resolve = r)),
      remove: async () => ({ configured: false }),
    });
    const saving = c.save("fixture");
    await vi.advanceTimersByTimeAsync(1001);
    expect(c.getSnapshot().phase).toBe("saving");
    expect(c.getSnapshot().configured).toBe(false);
    resolve({
      configured: true,
      validation: "not-checked",
      expiresAt: Date.now() + 3600000,
    });
    await saving;
    expect(c.getSnapshot().configured).toBe(true);
    expect(c.getSnapshot().phase).toBe("idle");
  } finally {
    vi.useRealTimers();
  }
});
it("requires status reconciliation after an uncertain mutation and never retries it automatically", async () => {
  let attempts = 0;
  const c = new PersonalApiKeyController();
  await c.configure({
    available: true,
    getStatus: async () => ({ configured: false }),
    save: async () => {
      attempts++;
      throw new ApiKeyFailure("unknown");
    },
    remove: async () => ({ configured: false }),
  });
  await c.save("fixture");
  expect(c.getSnapshot().needsReconciliation).toBe(true);
  await c.save("fixture");
  expect(attempts).toBe(1);
  await c.refresh();
  expect(c.getSnapshot().needsReconciliation).toBe(false);
  await c.save("fixture");
  expect(attempts).toBe(2);
});
