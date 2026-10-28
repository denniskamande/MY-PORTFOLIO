import { hasRecentTrackStore, mergeRecentTracks, type StoredTrack } from "./recent-store";
import { getSpotifyAccessToken, hasSpotifyRefreshToken, setResponseHeaders, type ApiRequest, type ApiResponse } from "./token";

type RefreshRequest = ApiRequest & {
  headers?: Record<string, string | string[] | undefined>;
};

type PlaybackItem = {
  id?: string;
  type?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  show?: { name?: string; images?: Array<{ url?: string }> };
  album?: { images?: Array<{ url?: string }> };
  external_urls?: { spotify?: string };
};

function mapTrack(item: PlaybackItem, playedAt: string): StoredTrack {
  const title = item.name ?? "Unknown track";
  const artist = item.artists?.map((entry) => entry.name).filter(Boolean).join(", ")
    || item.show?.name
    || "Spotify";
  const url = item.external_urls?.spotify ?? "https://open.spotify.com/";
  return {
    id: item.id ?? url,
    title,
    artist,
    image: item.album?.images?.[0]?.url ?? item.show?.images?.[0]?.url ?? null,
    url,
    playedAt,
  };
}

function matchesSecret(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function isAuthorized(req: RefreshRequest, secret: string): boolean {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const prefix = "Bearer ";
  return typeof value === "string"
    && value.startsWith(prefix)
    && matchesSecret(value.slice(prefix.length), secret);
}

export default async function handler(req: RefreshRequest, res: ApiResponse): Promise<void> {
  setResponseHeaders(res, 0);
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.CRON_SECRET;
  if (!secret || !isAuthorized(req, secret)) {
    res.status(401).json({ status: "unauthorized" });
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ status: "method_not_allowed" });
    return;
  }
  if (!hasSpotifyRefreshToken() || !hasRecentTrackStore()) {
    res.status(503).json({ status: "not_configured" });
    return;
  }

  try {
    const token = await getSpotifyAccessToken();
    if (!token) {
      res.status(503).json({ status: "spotify_unavailable" });
      return;
    }

    const [historyResponse, playbackResponse] = await Promise.all([
      fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);

    if (!historyResponse.ok) {
      res.status(historyResponse.status === 401 || historyResponse.status === 403 ? 503 : 502)
        .json({
          status: historyResponse.status === 401 || historyResponse.status === 403
            ? "spotify_reauthorization_required"
            : "history_unavailable",
        });
      return;
    }

    const history = (await historyResponse.json()) as {
      items?: Array<{ played_at?: string; track?: PlaybackItem | null }>;
    };
    const tracks = (history.items ?? []).flatMap((entry) => {
      const item = entry.track;
      if (!item || item.type === "episode") return [];
      return [mapTrack(item, entry.played_at ?? "")];
    });

    let currentTrack: StoredTrack | null = null;
    if (playbackResponse.ok) {
      const playback = (await playbackResponse.json()) as {
        progress_ms?: number | null;
        item?: PlaybackItem | null;
      };
      if (playback.item && playback.item.type !== "episode" && (playback.progress_ms ?? 0) >= 10_000) {
        currentTrack = mapTrack(playback.item, new Date().toISOString());
      }
    }

    const storedTracks = await mergeRecentTracks(currentTrack ? [currentTrack, ...tracks] : tracks);
    res.status(200).json({ status: "ok", saved: storedTracks.length, currentRecorded: Boolean(currentTrack) });
  } catch {
    res.status(502).json({ status: "refresh_failed" });
  }
}