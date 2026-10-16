import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { supabase } from "@/lib/auth/area-client";
import { safeImageUrl } from "@/lib/media";
import { CREW_LABEL } from "@/lib/tmdb/extras";

type Credit = { id: string; name: string; character: string | null; job: string | null; credit_type: string; profile_url: string | null };

/** TMDB cast and key crew for a movie or series; renders nothing when there are no credits. */
export function CastSection({ kind, id }: { kind: "movie" | "series"; id: string }) {
  const { data } = useQuery({
    queryKey: ["catalog", "credits", kind, id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("content_credits").select("id, name, character, job, credit_type, profile_url")
        .eq("content_kind", kind).eq("content_id", id).order("credit_type").order("sort_order").limit(60);
      if (error) throw error;
      return (data ?? []) as Credit[];
    },
    staleTime: 5 * 60_000,
  });
  const cast = (data ?? []).filter((c) => c.credit_type === "cast");
  const crew = (data ?? []).filter((c) => c.credit_type === "crew");
  if (!cast.length && !crew.length) return null;
  const byJob = new Map<string, string[]>();
  for (const c of crew) { const label = CREW_LABEL[c.job ?? ""] ?? c.job ?? ""; if (!label) continue; const l = byJob.get(label) ?? []; if (!l.includes(c.name)) l.push(c.name); byJob.set(label, l); }
  return (
    <section aria-label="Elenco" className="mx-auto max-w-[1600px] px-4 pt-8 md:px-10">
      {byJob.size > 0 && <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">{[...byJob].map(([job, names]) => <div key={job}><dt className="text-muted-foreground">{job}</dt><dd className="font-medium">{names.join(", ")}</dd></div>)}</dl>}
      {cast.length > 0 && <>
        <h2 className="mb-4 text-2xl font-semibold">Elenco</h2>
        <ul className="flex gap-4 overflow-x-auto pb-2">
          {cast.map((c) => { const img = safeImageUrl(c.profile_url); return (
            <li key={c.id} className="w-24 shrink-0 text-center sm:w-28">
              <div className="mx-auto mb-2 aspect-square w-20 overflow-hidden rounded-full bg-muted sm:w-24">
                {img ? <img src={img} alt={c.name} loading="lazy" className="h-full w-full object-cover" /> : <UserRound className="m-auto h-full w-10 text-muted-foreground" />}
              </div>
              <p className="line-clamp-2 text-xs font-medium">{c.name}</p>
              {c.character && <p className="line-clamp-2 text-xs text-muted-foreground">{c.character}</p>}
            </li>); })}
        </ul>
      </>}
    </section>
  );
}
