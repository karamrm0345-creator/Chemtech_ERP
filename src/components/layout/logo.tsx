import { cn } from "@/lib/cn";

/** Company logo (uploaded in settings, or the bundled ChemTech logo). */
export function Logo({ name, light, size = "md" }: { name: string; light?: boolean; size?: "sm" | "md" | "lg" }) {
  const h = { sm: "h-9", md: "h-12", lg: "h-24" }[size];
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src="/api/logo" alt={`${name} logo`} className={cn(h, "w-auto object-contain")} />;
  return light ? <span className="inline-flex items-center rounded-md bg-white px-2 py-1 shadow-sm">{img}</span> : img;
}

