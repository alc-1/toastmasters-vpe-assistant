import { describe, expect, it } from "vitest";

import {
  areFeaturesUnlocked,
  countCompletedSetupSteps,
  evaluateSetupPipeline,
  isSetupStepComplete,
} from "../src/shared/stepper-info";
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

describe("evaluateSetupPipeline", () => {
  it("is 'required' until Setup itself is complete", () => {
    expect(evaluateSetupPipeline(EMPTY).bannerState).toBe("required");
    expect(evaluateSetupPipeline({ setup: { done: false } }).bannerState).toBe("required");
  });

  it("is 'progress' once Setup is done but a later step is still incomplete", () => {
    expect(
      evaluateSetupPipeline({
        setup: { done: true },
        syncData: { done: true },
        clubReview: { done: true, locked: true },
        members: { done: true, locked: true },
      }).bannerState
    ).toBe("progress");
  });

  it("is 'ready' only when every step is done and reached", () => {
    expect(evaluateSetupPipeline(ALL_DONE).bannerState).toBe("ready");
  });

  it("is 'reviewNeeded' when Member Review is reached, actionable, and still has items", () => {
    const result = evaluateSetupPipeline({
      setup: { done: true },
      syncData: { done: true },
      clubReview: { done: true },
      members: { done: false, warning: true, warningCount: 3 },
    });
    expect(result.bannerState).toBe("reviewNeeded");
    expect(result.pendingReviewCount).toBe(3);
  });

  it("stays 'progress' while Member Review's prerequisites are unmet, even with pending items", () => {
    // `disabled` here stands in for "no profile / missing data / Club Review
    // still pending" — never Privacy Mode, which stepper-info keeps out of
    // `disabled` entirely, so toggling the name mask can't reach this branch.
    const info = {
      setup: { done: true },
      syncData: { done: true },
      clubReview: { done: false },
      members: { done: false, disabled: true, warning: true, warningCount: 3 },
    };
    expect(evaluateSetupPipeline(info).bannerState).toBe("progress");
    expect(evaluateSetupPipeline(info).pendingReviewCount).toBe(0);
  });

  it("does not raise 'reviewNeeded' for a Member Review step never reached", () => {
    expect(
      evaluateSetupPipeline({
        setup: { done: true },
        syncData: { done: true },
        clubReview: { done: true, locked: true },
        members: { done: false, locked: true, warning: true, warningCount: 3 },
      }).bannerState
    ).toBe("progress");
  });

  it("resumes at the furthest step the profile has actually reached", () => {
    // computeStepperInfo() marks every not-yet-visited step past Setup as
    // `locked`; Setup (index 0) is never locked.
    expect(
      evaluateSetupPipeline({
        setup: { done: true },
        syncData: { done: true },
        clubReview: { locked: true },
        members: { locked: true },
      }).resumeStep
    ).toBe("syncData");
    expect(
      evaluateSetupPipeline({
        setup: {},
        syncData: { locked: true },
        clubReview: { locked: true },
        members: { locked: true },
      }).resumeStep
    ).toBe("setup");
  });

  it("reports completed-step count and total", () => {
    const r = evaluateSetupPipeline({ setup: { done: true }, syncData: { done: true } });
    expect(r.completedSteps).toBe(2);
    expect(r.totalSteps).toBe(4);
  });
});
