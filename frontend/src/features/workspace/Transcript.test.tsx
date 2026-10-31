// @vitest-environment jsdom
import { afterEach, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Transcript } from "./Transcript";
afterEach(cleanup);
it("presents timed phrases with clear narration and live hierarchy", () => {
  render(
    <Transcript
      variant="presenter"
      sessionIds={new Set(["a"])}
      segments={[
        {
          id: "a",
          slideId: "one",
          text: "A useful statement.",
          start: 2,
          end: 5,
        },
      ]}
      interim="Next thought"
    />,
  );
  expect(
    screen.getByRole("list", { name: "Current session narration" }),
  ).toBeTruthy();
  expect(screen.getByText("0:02 – 0:05")).toBeTruthy();
  expect(screen.getByText("Narration")).toBeTruthy();
  expect(screen.getByText("Speaking now")).toBeTruthy();
  expect(screen.getByText("Next thought")).toBeTruthy();
});
