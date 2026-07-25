// Demo-clip manifest (PLAN.md Decision #25 — demo-clips-first upload
// hierarchy). public/demo/manifest.json and the actual clips don't exist
// yet (sourced separately) — this must degrade gracefully to an empty list,
// not a broken UI, whenever the file is missing, empty, or malformed.

export interface DemoClip {
  id: string;
  title: string;
  videoPath: string;
  resultsPath: string;
}

function isDemoClip(v: unknown): v is DemoClip {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.videoPath === "string" &&
    typeof c.resultsPath === "string"
  );
}

export async function fetchDemoManifest(): Promise<DemoClip[]> {
  try {
    const res = await fetch("/demo/manifest.json", { cache: "no-store" });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.filter(isDemoClip);
  } catch {
    return [];
  }
}
