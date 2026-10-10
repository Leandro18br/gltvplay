import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlinePlayer } from "./InlinePlayer";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mocks.session }, rpc: mocks.rpc } }));
vi.mock("./VideoPlayerFrame", () => ({ VideoPlayerFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./EmbedPlayer", () => ({ EmbedPlayer: () => null }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "viewer" } } } });
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: [{ id: args._content_id, url: `https://example.test/${args._content_id}.mp4`, type: "url" }], error: null }));
});

describe("Explicit inline playback", () => {
  it("keeps movie playback gated behind Play by default", () => {
    render(<InlinePlayer kind="movie" id="movie-1" title="Movie" poster={null} />);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reproduzir Movie" })).toBeEnabled();
  });
  it("loads only the explicitly selected episode and its own source", async () => {
    const { container, rerender } = render(<InlinePlayer key="episode-2" autoStart kind="episode" id="episode-2" title="Episode 2" poster={null} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBe("https://example.test/episode-2.mp4"));
    expect(mocks.rpc).toHaveBeenCalledWith("get_playback_sources", { _kind: "episode", _content_id: "episode-2" });
    rerender(<InlinePlayer key="episode-3" autoStart kind="episode" id="episode-3" title="Episode 3" poster={null} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBe("https://example.test/episode-3.mp4"));
    expect(mocks.rpc.mock.calls.map(call => call[1]._content_id)).toEqual(["episode-2", "episode-3"]);
  });
});