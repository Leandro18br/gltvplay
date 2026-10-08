export function adminHead(section: string, description: string) {
  const title = `${section} — GLTV Plus ADM`;
  return {meta:[{title},{name:"description",content:description},{property:"og:title",content:title},{property:"og:description",content:description},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"},{name:"robots",content:"noindex, nofollow"}]};
}