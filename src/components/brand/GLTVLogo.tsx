import { cn } from "@/lib/utils";

/** Official GLTV Play logo (public/brand/gltv-logo.png, 2:1 ratio). */
export const GLTV_LOGO_SRC = "/brand/gltv-logo.png";

const SIZES = {
  header: "h-9 md:h-10",
  panel: "h-9",
  login: "h-20 sm:h-24",
} as const;

export function GLTVLogo({ size = "header", className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <img
      src={GLTV_LOGO_SRC}
      alt="GLTV Play"
      width={900}
      height={450}
      decoding="async"
      className={cn("block w-auto max-w-full shrink-0 object-contain", SIZES[size], className)}
    />
  );
}
