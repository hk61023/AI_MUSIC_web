export type Track = {
  id: string;
  title: string;
  description: string;
  story: string;
  genre: string;
  mood: string;
  vocal: "instrumental" | "vocal";
  source: string;
  generatedAt: string;
  tags: string[];
  lyrics: string;
  prompt: string;
  featured: boolean;
  downloadAllowed: boolean;
  rightsConfirmed: boolean;
  rightsEvidence?: string;
  licenseText: string;
  createdAt: string;
  status: "draft" | "published";
  processing: "empty" | "queued" | "processing" | "ready" | "failed";
  processingError?: string;
  duration: number;
  mediaVersion?: number;
  hasCover: boolean;
  artwork: string;
};
export type Playlist = {
  id: string;
  title: string;
  description: string;
  artwork: string;
  trackIds: string[];
};
export type Catalog = { tracks: Track[]; playlists: Playlist[] };
export const artworkUrl = (
  t: Pick<Track, "id" | "hasCover" | "artwork" | "mediaVersion">,
) =>
  t.hasCover
    ? `/media/${t.id}/cover?v=${t.mediaVersion || 0}`
    : `/covers/${t.artwork || "violet"}.svg`;
export const time = (n: number) => {
  const value = Number.isFinite(n) && n > 0 ? n : 0;
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试");
  }
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "网络连接失败，请稍后重试" }));
    throw new Error(body.error || "操作失败");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled in private browsers. */
  }
}
