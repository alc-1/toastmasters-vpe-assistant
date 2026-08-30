import { describe, expect, it } from "vitest";

import { areFeaturesUnlocked, countCompletedSetupSteps, isSetupStepComplete } from "../src/shared/stepper-info";
import type { StepperInfo } from "../src/shared/app-shell";

const EMPTY: StepperInfo = {};

const ALL_DONE: StepperInfo = {
  setup: { done: true },
  syncData: { done: true },
  clubReview: { done: true },
  members: { done: true },
};

describe("countCompletedSetupSteps", () => {
  it("is 0 for an empty StepperInfo", () => {
    expect(countCompletedSetupSteps(EMPTY)).toBe(0);
  });

  it("counts only the four setup steps that are done", () => {
    expect(
      countCompletedSetupSteps({
        setup: { done: true },
        syncData: { done: true },
        clubReview: { done: false },
        members: { done: undefined },
        // report is not one of the four setup steps — must not be counted
        report: { done: true },
      })
    ).toBe(2);
  });

  it("is 4 when every setup step is done", () => {
    expect(countCompletedSetupSteps(ALL_DONE)).toBe(4);
  });

  it("does not count a step whose requirement is met but has never been visited", () => {
    // Club Review auto-satisfied (every club matched exactly) but the user
    // hasn't reached it yet — the stepper still shows it as the next step, so
    // the tracker must too.
    expect(
      countCompletedSetupSteps({
        setup: { done: true },
        syncData: { done: true },
        clubReview: { done: true, locked: true },
        members: { done: true, locked: true },
      })
    ).toBe(2);
  });
});

describe("isSetupStepComplete", () => {
  it("is false for a missing or not-done step", () => {
    expect(isSetupStepComplete(undefined)).toBe(false);
    expect(isSetupStepComplete({ done: false })).toBe(false);
  });

  it("is true for a done step the user has reached", () => {
    expect(isSetupStepComplete({ done: true })).toBe(true);
  });

  it("is false for a done step that is still locked (never visited)", () => {
    expect(isSetupStepComplete({ done: true, locked: true })).toBe(false);
  });
});

describe("areFeaturesUnlocked", () => {
  it("is false with no profile / no import", () => {
    expect(areFeaturesUnlocked(EMPTY)).toBe(false);
  });

  it("is false when only setup is done", () => {
    expect(areFeaturesUnlocked({ setup: { done: true } })).toBe(false);
  });

  it("is true once setup and data import are both done, regardless of matching", () => {
    expect(areFeaturesUnlocked({ setup: { done: true }, syncData: { done: true } })).toBe(true);
    expect(areFeaturesUnlocked(ALL_DONE)).toBe(true);
  });
});
