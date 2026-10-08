import { Link } from "@tanstack/react-router";
import { Layers, PlaySquare } from "lucide-react";
import type { ResourceConfig, Field } from "@/components/admin/ResourceManager";
import { Thumb } from "@/components/admin/ResourceManager";
import { KIND_OPTIONS, STATUS_OPTIONS, type Row } from "./db";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { db } from "./db";

function SourcesCount({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["admin", "playback_sources", "count", id], queryFn: async () => {
    const { count } = await db.from("playback_sources").select("id", { count: "exact", head: true }).eq("content_kind", "episode").eq("content_id", id).eq("is_active", true);
    return count ?? 0;
  } });
  if (q.data == null) return <span className="text-muted-foreground">…</span>;
  return q.data ? <span className="rounded-full border border-primary/40 bg-accent px-2 py-0.5 text-xs text-accent-foreground">{q.data} player(s)</span> : <span className="text-xs text-muted-foreground">Sem player</span>;
}

const status: Field = { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "published", editOnly: true };
const featured: Field = { name: "featured", label: "Marcar como destaque", type: "boolean" };
const category: Field = { name: "category_id", label: "Categoria", type: "relation", table: "categories", select: "id,name" };
const sortOrder: Field = { name: "sort_order", label: "Ordem", type: "number", defaultValue: 0 };

const titleSorts = [
  { value: "created_at:desc", label: "Mais recentes" },
  { value: "created_at:asc", label: "Mais antigos" },
  { value: "title:asc", label: "Título A–Z" },
  { value: "title:desc", label: "Título Z–A" },
  { value: "release_year:desc", label: "Ano (novo→antigo)" },
  { value: "sort_order:asc", label: "Ordem manual" },
];

export const moviesConfig: ResourceConfig = {
  table: "movies", title: "Filmes", singular: "Filme", searchCol: "title",
  select: "*, categories(name)", hasStatus: true, hasFeatured: true, slugFrom: "title", sortOptions: titleSorts,
  columns: [
    { key: "poster_url", label: "", render: (r) => <Thumb src={r.poster_url} />, className: "w-14" },
    { key: "title", label: "Título", render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.categories?.name ?? "Sem categoria"}</p></div> },
    { key: "release_year", label: "Ano" },
  ],
  fields: [
    { name: "title", label: "Título", type: "text", required: true },
    { name: "original_title", label: "Título original", type: "text" },
    { name: "description", label: "Descrição", type: "textarea" },
    { name: "release_year", label: "Ano", type: "number" },
    { name: "duration_minutes", label: "Duração (min)", type: "number" },
    { name: "age_rating", label: "Classificação indicativa", type: "select", options: ["L", "10", "12", "14", "16", "18"].map((v) => ({ value: v, label: v })) },
    { name: "language", label: "Idioma", type: "text", placeholder: "Português" },
    { name: "country", label: "País", type: "text" },
    category, status, sortOrder, featured,
    { name: "trailer_url", label: "Trailer (URL)", type: "url", full: true },
    { name: "poster_url", label: "Poster", type: "image", folder: "posters", aspect: "aspect-[2/3]" },
    { name: "backdrop_url", label: "Backdrop", type: "image", folder: "backdrops" },
    { name: "genres", label: "Gêneros", type: "genres", joinTable: "movie_genres", fk: "movie_id" },
    { name: "playback", label: "Fonte de reprodução", type: "playback", kind: "movie", full:true },
  ],
};

export const seriesConfig: ResourceConfig = {
  table: "series", title: "Séries", singular: "Série", searchCol: "title",
  select: "*, categories(name), seasons(count)", hasStatus: true, hasFeatured: true, slugFrom: "title", sortOptions: titleSorts,
  columns: [
    { key: "poster_url", label: "", render: (r) => <Thumb src={r.poster_url} />, className: "w-14" },
    { key: "title", label: "Título", render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.categories?.name ?? "Sem categoria"}</p></div> },
    { key: "release_year", label: "Ano" },
    { key: "seasons", label: "Temporadas", render: (r) => r.seasons?.[0]?.count ?? 0 },
  ],
  rowActions: (r) => (
    <Button asChild size="icon" variant="ghost" aria-label="Abrir série"><Link to="/admin/series/$id" params={{ id: r.id }}><Layers /></Link></Button>
  ),
  fields: [
    { name: "title", label: "Título", type: "text", required: true },
    { name: "original_title", label: "Título original", type: "text" },
    { name: "description", label: "Descrição", type: "textarea" },
    { name: "release_year", label: "Ano", type: "number" },
    { name: "age_rating", label: "Classificação", type: "select", options: ["L", "10", "12", "14", "16", "18"].map((v) => ({ value: v, label: v })) },
    category, status, sortOrder, featured,
    { name: "trailer_url", label: "Trailer (URL)", type: "url", full: true },
    { name: "poster_url", label: "Poster", type: "image", folder: "posters", aspect: "aspect-[2/3]" },
    { name: "backdrop_url", label: "Backdrop", type: "image", folder: "backdrops" },
    { name: "genres", label: "Gêneros", type: "genres", joinTable: "series_genres", fk: "series_id" },
  ],
};

export const seasonsConfig: ResourceConfig = {
  table: "seasons", title: "Temporadas", singular: "Temporada", searchCol: "title",
  select: "*, series(title), episodes(count)",
  hasStatus: true, reorderCol: "season_number",
  sortOptions: [{ value: "season_number:asc", label: "Número" }, { value: "sort_order:asc", label: "Ordem manual" }, { value: "created_at:desc", label: "Mais recentes" }],
  scope: { col: "series_id", table: "series", select: "id,title", label: "Série", labelOf: (r) => r.title },
  columns: [
    { key: "poster_url", label: "", render: (r) => <Thumb src={r.poster_url} />, className: "w-14" },
    { key: "series", label: "Série", render: (r) => r.series?.title },
    { key: "season_number", label: "Nº" },
    { key: "title", label: "Título" },
    { key: "episodes", label: "Episódios", render: (r) => r.episodes?.[0]?.count ?? 0 },
  ],
  rowActions: (r) => (
    <Button asChild size="icon" variant="ghost" aria-label="Gerenciar episódios"><Link to="/admin/series/$id/temporada/$seasonId" params={{ id: r.series_id, seasonId: r.id }}><PlaySquare /></Link></Button>
  ),
  fields: [
    { name: "series_id", label: "Série", type: "relation", table: "series", select: "id,title", required: true },
    { name: "season_number", label: "Número da temporada", type: "number", required: true },
    { name: "title", label: "Nome da temporada", type: "text" },
    { name: "description", label: "Descrição", type: "textarea" },
    { ...status, defaultValue: "published" }, sortOrder,
    { name: "poster_url", label: "Poster/capa (opcional)", type: "image", folder: "seasons", aspect: "aspect-[2/3]" },
  ],
};

const seasonLabel = (r: Row) => `${r.series?.title ?? "?"} — T${r.season_number}`;

export const episodesConfig: ResourceConfig = {
  table: "episodes", title: "Episódios", singular: "Episódio", searchCol: "title",
  select: "*, seasons(season_number, series(title))", hasStatus: true, reorderCol: "episode_number",
  sortOptions: [{ value: "episode_number:asc", label: "Número do episódio" }, { value: "created_at:desc", label: "Mais recentes" }, { value: "title:asc", label: "Título A–Z" }],
  scope: { col: "season_id", table: "seasons", select: "id, season_number, series(title)", label: "Temporada", labelOf: seasonLabel },
  columns: [
    { key: "thumbnail_url", label: "", render: (r) => <Thumb src={r.thumbnail_url} wide />, className: "w-24" },
    { key: "episode_number", label: "Nº" },
    { key: "title", label: "Título", render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.seasons ? seasonLabel(r.seasons) : ""}</p></div> },
    { key: "duration_minutes", label: "Duração", render: (r) => (r.duration_minutes ? `${r.duration_minutes} min` : "—") },
    { key: "sources", label: "Fonte/Player", render: (r) => <SourcesCount id={r.id} /> },
  ],
  fields: [
    { name: "season_id", label: "Temporada", type: "relation", table: "seasons", select: "id, season_number, series(title)", labelOf: seasonLabel, required: true },
    { name: "episode_number", label: "Número do episódio", type: "number", required: true },
    { name: "title", label: "Título", type: "text", required: true, full: true },
    { name: "description", label: "Descrição", type: "textarea" },
    { name: "duration_minutes", label: "Duração (min)", type: "number" },
    { name: "release_date", label: "Data de lançamento", type: "text", placeholder: "AAAA-MM-DD" },
    status,
    { name: "thumbnail_url", label: "Thumbnail", type: "image", folder: "thumbnails" },
    { name: "playback", label: "Fonte de reprodução", type: "playback", kind: "episode", full:true },
  ],
};

export const channelsConfig: ResourceConfig = {
  table: "channels", title: "Canais", singular: "Canal", searchCol: "name",
  select: "*, categories(name)", hasStatus: true, hasFeatured: true, slugFrom: "name",
  sortOptions: [{ value: "sort_order:asc", label: "Ordem manual" }, { value: "name:asc", label: "Nome A–Z" }, { value: "created_at:desc", label: "Mais recentes" }],
  columns: [
    { key: "logo_url", label: "", render: (r) => <Thumb src={r.logo_url} wide />, className: "w-24" },
    { key: "name", label: "Nome", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "categories", label: "Categoria", render: (r) => r.categories?.name ?? "—" },
  ],
  fields: [
    { name: "name", label: "Nome", type: "text", required: true },
    category,
    { name: "description", label: "Descrição", type: "textarea" },
    status, sortOrder, featured,
    { name: "logo_url", label: "Logo", type: "image", folder: "logos" },
    { name: "playback", label: "URL de transmissão autorizada", type: "playback", kind: "channel" },
  ],
};

export const categoriesConfig: ResourceConfig = {
  table: "categories", title: "Categorias", singular: "Categoria", searchCol: "name", hasStatus: true,
  sortOptions: [{ value: "sort_order:asc", label: "Ordem manual" }, { value: "name:asc", label: "Nome A–Z" }],
  columns: [
    { key: "image_url", label: "", render: (r) => <Thumb src={r.image_url} wide />, className: "w-24" },
    { key: "name", label: "Nome", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "slug", label: "Slug" },
  ],
  fields: [
    { name: "name", label: "Nome", type: "text", required: true },
    { name: "slug", label: "Slug (URL)", type: "text", required: true, placeholder: "ex: acao" },
    { name: "description", label: "Descrição", type: "textarea" },
    { ...status, defaultValue: "published" }, sortOrder,
    { name: "image_url", label: "Imagem", type: "image", folder: "categories" },
  ],
};

export const genresConfig: ResourceConfig = {
  table: "genres", title: "Gêneros", singular: "Gênero", searchCol: "name",
  select: "*, movie_genres(count), series_genres(count)",
  sortOptions: [{ value: "name:asc", label: "Nome A–Z" }, { value: "created_at:desc", label: "Mais recentes" }],
  columns: [
    { key: "name", label: "Nome", render: (r) => <div><p className="font-medium">{r.name}</p>{r.is_fixed && <p className="text-xs text-muted-foreground">Padrão do sistema</p>}</div> },
    { key: "movies", label: "Filmes", render: (r) => r.movie_genres?.[0]?.count ?? 0 },
    { key: "series", label: "Séries", render: (r) => r.series_genres?.[0]?.count ?? 0 },
    { key: "active", label: "Status", render: () => <span className="rounded-full border border-primary/40 bg-accent px-2 py-0.5 text-xs text-accent-foreground">Ativa</span> },
  ],
  fields: [
    { name: "name", label: "Nome", type: "text", required: true },
    { name: "slug", label: "Slug", type: "text", required: true, placeholder: "ex: comedia" },
  ],
};

export const bannersConfig: ResourceConfig = {
  table: "banners", title: "Banners da página inicial", singular: "Banner", searchCol: "title", hasActive: true,
  sortOptions: [{ value: "sort_order:asc", label: "Ordem" }, { value: "created_at:desc", label: "Mais recentes" }],
  columns: [
    { key: "image_url", label: "", render: (r) => <Thumb src={r.image_url} wide />, className: "w-24" },
    { key: "title", label: "Título", render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.subtitle}</p></div> },
    { key: "sort_order", label: "Ordem" },
  ],
  fields: [
    { name: "title", label: "Título", type: "text", required: true },
    { name: "subtitle", label: "Subtítulo", type: "text" },
    { name: "button_label", label: "Texto do botão", type: "text", placeholder: "Assistir agora" },
    { name: "button_url", label: "Link do botão (opcional)", type: "url" },
    { name: "content_kind", label: "Tipo de conteúdo relacionado", type: "select", options: KIND_OPTIONS },
    { name: "content_id", label: "Conteúdo relacionado", type: "content" },
    sortOrder,
    { name: "is_active", label: "Ativo", type: "boolean", defaultValue: true },
    { name: "image_url", label: "Imagem", type: "image", folder: "banners" },
  ],
};
