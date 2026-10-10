import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ page: undefined as undefined | React.ComponentType }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => { state.page = options.component; return { useParams: () => ({ slug: "series" }) }; },
  notFound: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useSuspenseQuery: () => ({ data: {
  item: { title: "Series" }, seasons: [
    { id: "s1", season_number: 1, episodes: [{ id: "e1", title: "First", episode_number: 1 }, { id: "e2", title: "Second", episode_number: 2 }] },
    { id: "s2", season_number: 2, episodes: [{ id: "e3", title: "Third", episode_number: 1 }] },
  ],
} }) }));
vi.mock("@/lib/catalog", () => ({ seriesDetailQuery: vi.fn(), formatDuration: () => "" }));
vi.mock("@/components/site/SiteShell", () => ({ SiteShell: ({ children }: { children: React.ReactNode }) => <>{children}</>, RetryState: () => null, EmptyState: () => null }));
vi.mock("@/components/site/DetailHero", () => ({ DetailHero: ({ player }: { player?: React.ReactNode }) => <>{player}</> }));
vi.mock("@/components/site/InlinePlayer", () => ({ InlinePlayer: ({ id }: { id: string }) => <div role="region" aria-label={id} /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (id: string) => void }) => <select aria-label="Season" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
import "@/routes/serie.$slug";
afterEach(cleanup);
describe("Series episode selection", () => {
  it("opens without a player, mounts the selected episode before scrolling, and never plays/scrolls on season changes", async () => {
    const Page = state.page;
    if (!Page) throw new Error("Missing series component");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => { expect(screen.getByRole("region", { name: "e2" })).toBeInTheDocument(); });
    render(<Page />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s2" } });
    expect(screen.getByRole("button", { name: /Third/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "e2" })).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledTimes(1);
    scroll.mockRestore();
  });
});