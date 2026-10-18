import { describe, expect, it } from "vitest";
import { MEDIA_WAIT_TIMEOUT_MS, mediaErrorMessage } from "./media-error";
describe("native media failures", () => {
  it("distinguishes decoding from network failures", () => {
    expect(mediaErrorMessage(3)).not.toBe(mediaErrorMessage(2));
    expect(mediaErrorMessage(4)).not.toBe(mediaErrorMessage(1));
  });
  it("bounds the loading wait to twenty seconds", () => { expect(MEDIA_WAIT_TIMEOUT_MS).toBe(20000); });
});