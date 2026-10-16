import { describe, expect, it } from "vitest";
import { CONTROLS_IDLE_MS, PLAYBACK_RATES, seekTarget, isMediaControl } from "./controls";

describe("movie and episode control rules", () => {
  it("does not seek or toggle while navigating buttons or native sliders", () => {
    const button = document.createElement('button'), slider = document.createElement('span');
    slider.setAttribute('role', 'slider');
    expect(isMediaControl(button)).toBe(true);
    expect(isMediaControl(slider)).toBe(true);
    expect(isMediaControl(document.createElement('div'))).toBe(false);
  });
  it("rewinds ten seconds without going below zero", () => {
    expect(seekTarget(32, -10, 108)).toBe(22);
    expect(seekTarget(4, -10, 108)).toBe(0);
  });
  it("advances ten seconds without exceeding duration", () => {
    expect(seekTarget(32, 10, 108)).toBe(42);
    expect(seekTarget(103, 10, 108)).toBe(108);
  });
  it("does not seek unknown or infinite durations", () => {
    expect(seekTarget(32, 10, Infinity)).toBe(32);
    expect(seekTarget(32, -10, NaN)).toBe(32);
  });
  it("offers exactly the requested playback speeds", () => {
    expect([...PLAYBACK_RATES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
  it("hides idle playing controls after three seconds", () => {
    expect(CONTROLS_IDLE_MS).toBe(3000);
  });
});