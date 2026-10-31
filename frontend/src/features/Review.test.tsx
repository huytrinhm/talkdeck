// @vitest-environment jsdom
import { afterEach, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Review } from "./Review";
import { newProject, blankSlide } from "../domain/types";
import { buildRehearsal } from "../domain/review";
afterEach(cleanup);
it("shows useful empty practice guidance without chart-method or development copy", () => {
  const p = newProject([]);
  p.slides = [blankSlide()];
  p.rehearsals = [buildRehearsal(p.slides, [], 0)];
  render(
    <Review
      project={p}
      onChange={() => {}}
      onAgain={() => {}}
      onPresent={() => {}}
      onDone={() => {}}
    />,
  );
  expect(
    screen.getByText(
      "No speech captured yet. Practice again to see your speaking pace.",
    ),
  ).not.toBeNull();
  expect(
    screen.queryByText(/local rules|heuristics|word timestamps/),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("1 slide was not rehearsed.")).not.toBeNull();
  expect(screen.queryByText("1 slides were not rehearsed.")).toBeNull();
});
it("omits coach and empty feedback on Overview, changes and completion without a service", () => {
  const p = newProject([]);
  p.slides = [blankSlide()];
  p.rehearsals = [buildRehearsal(p.slides, [], 0)];
  render(
    <Review
      project={p}
      onChange={() => {}}
      onAgain={() => {}}
      onPresent={() => {}}
      onDone={() => {}}
    />,
  );
  const absent = () => {
    expect(document.querySelector(".coach-review-notes")).toBeNull();
    expect(screen.queryByText("Practice coach")).toBeNull();
    expect(
      screen.queryByText(/No coach feedback|Coach notes last|Coaching tip/),
    ).toBeNull();
    expect(document.querySelector(".review-feedback")).toBeNull();
  };
  absent();
  fireEvent.click(screen.getByRole("tab", { name: /Slide changes/ }));
  absent();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  absent();
});
