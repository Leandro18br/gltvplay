import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackResource } from "./PlaybackResource";
const mock = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => mock.probe }));
vi.mock("@/lib/playback/playback.functions", () => ({ probePlayerUrl: () => {} }));
beforeEach(() => mock.probe.mockReset());
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("shared resource resolver", () => {
  it("delivers the exact original URL only after classification", async () => {
    const url = "https://example.com/play/item#.mp4";
    mock.probe.mockResolvedValue({ kind: "html", playUrl: url });
    const consumer = vi.fn(() => <div />);
    render(<PlaybackResource url={url}>{consumer}</PlaybackResource>);
    await waitFor(() => expect(consumer).toHaveBeenCalledWith(expect.objectContaining({ kind: "html", playUrl: url })));
    expect(mock.probe).toHaveBeenCalledWith({ data: { url } });
  });
  it("times out once, permits retry and ignores the late response", async () => {
    vi.useFakeTimers();
    let finish: ((value: unknown) => void) | undefined;
    mock.probe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ kind: "video", playUrl: "https://example.com/play/2" });
    const consumer = vi.fn(() => <div />);
    render(<PlaybackResource url="https://example.com/play/2">{consumer}</PlaybackResource>);
    await act(async () => { vi.advanceTimersByTime(15000); });
    await act(async () => { finish?.({ kind: "html", playUrl: "https://example.com/late" }); });
    expect(consumer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await act(async () => {});
    expect(mock.probe).toHaveBeenCalledTimes(2);
    expect(consumer).toHaveBeenCalledWith(expect.objectContaining({ kind: "video" }));
  });
});