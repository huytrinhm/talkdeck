// @vitest-environment jsdom
import { afterEach, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ApiKeySettings } from "./ApiKeySettings";
import {
  PersonalApiKeyController,
  type PersonalApiKeyPort,
} from "../services/personalApiKey";
afterEach(cleanup);
it("labels stored-but-unverified keys and requires an explicit Check key action", async () => {
  let checks = 0;
  const c = new PersonalApiKeyController();
  await c.configure({
    available: true,
    verifiesKey: false,
    getStatus: async () => ({ configured: true, validation: "not-checked" }),
    save: async () => ({ configured: true, validation: "not-checked" }),
    remove: async () => ({ configured: false }),
    verify: async () => {
      checks++;
      return { configured: true, validation: "verified" };
    },
  });
  render(<ApiKeySettings controller={c} />);
  expect(screen.getByText("Not verified")).toBeTruthy();
  expect(checks).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Check key" }));
  await waitFor(() => expect(screen.getByText("Key verified")).toBeTruthy());
  expect(checks).toBe(1);
});
it("keeps secret entry unavailable until a secure personal service is configured", () => {
  render(<ApiKeySettings controller={new PersonalApiKeyController()} />);
  expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  expect(
    screen.getByText("Personal API keys are not supported on this server yet."),
  ).toBeTruthy();
  expect(screen.getByText(/No ChatGPT sign-in is required/)).toBeTruthy();
});
it("supports masked reveal and clears the draft immediately while awaiting real service acknowledgement", async () => {
  const p: PersonalApiKeyPort = {
    available: true,
    verifiesKey: true,
    getStatus: async () => ({ configured: false }),
    save: () => new Promise(() => {}),
    remove: async () => ({ configured: false }),
  };
  const c = new PersonalApiKeyController();
  await c.configure(p);
  render(<ApiKeySettings controller={c} />);
  const input = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
  fireEvent.change(input, {
    target: { value: "fixture-value-not-a-real-credential" },
  });
  expect(input.type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
  expect(input.type).toBe("text");
  fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
  expect(input.value).toBe("");
  expect(input.type).toBe("password");
  expect(screen.getByRole("button", { name: "Verifying…" })).toBeTruthy();
  expect(screen.queryByText(/API key configured\./)).toBeNull();
});
it("supports replace and acknowledged removal without rendering a stored key", async () => {
  const p: PersonalApiKeyPort = {
    available: true,
    verifiesKey: true,
    getStatus: async () => ({ configured: true }),
    save: async () => ({ configured: true }),
    remove: async () => ({ configured: false }),
  };
  const c = new PersonalApiKeyController();
  await c.configure(p);
  render(<ApiKeySettings controller={c} />);
  expect(screen.getByText(/API key configured\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
  expect(screen.getByLabelText("OpenAI API key")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel replacement" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await waitFor(() =>
    expect(screen.queryByText(/API key configured\./)).toBeNull(),
  );
  expect(
    (screen.getByLabelText("OpenAI API key") as HTMLInputElement).value,
  ).toBe("");
});
