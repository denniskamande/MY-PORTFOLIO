import { getSpotifyAccessToken, hasSpotifyRefreshToken, setResponseHeaders, spotifyReconnectRequired, type ApiRequest, type ApiResponse } from "./token";
import { hasRecentTrackStore, mergeRecentTracks, recordRecentTrack, type StoredTrack } from "./recent-store";

function trackId(id: string | undefined, url: string | undefined, title: string, artist: string): string {
  return id ?? url ?? `${title.toLocaleLowerCase()}::${artist.toLocaleLowerCase()}`;
}

type PlaybackItem = {
  id?: string;
  type?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  show?: { name?: string; images?: Array<{ url?: string }> };
  album?: { images?: Array<{ url?: string }> };
  external_urls?: { spotify?: string };
};

function mapPlaybackItem(item: PlaybackItem, playedAt: string): StoredTrack {
  const title = item.name ?? "Unknown track";
  const artist = item.artists?.map((entry) => entry.name).filter(Boolean).join(", ")
    || item.show?.name
    || "Spotify";
  const url = item.external_urls?.spotify ?? "https://open.spotify.com/";
  return {
    id: trackId(item.id, item.external_urls?.spotify, title, artist),
    title,
    artist,
    image: item.album?.images?.[0]?.url ?? item.show?.images?.[0]?.url ?? null,
    url,
    playedAt,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setResponseHeaders(res, 0);
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ status: "error" });
    return;
  }
  if (!hasSpotifyRefreshToken()) {
    res.status(200).json({ status: "unconfigured", tracks: [] });
    return;
  }

  try {
    const token = await getSpotifyAccessToken();
    if (!token) {
      res.status(200).json({ status: spotifyReconnectRequired() ? "reauthorize" : "unavailable", tracks: [] });
      return;
    }

    const usePersistentHistory = hasRecentTrackStore();
    let recentTracks: StoredTrack[] = [];
    const historyResponse = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (historyResponse.ok) {
      const history = (await historyResponse.json()) as {
        items?: Array<{
          played_at?: string;
          track?: {
            id?: string;
            name?: string;
            artists?: Array<{ name?: string }>;
            album?: { images?: Array<{ url?: string }> };
            external_urls?: { spotify?: string };
          };
        }>;
      };
      recentTracks = (history.items ?? []).flatMap((entry) => {
        if (!entry.track) return [];
        const track = mapPlaybackItem(entry.track, entry.played_at ?? "");
        return [track];
      });
    } else if (!usePersistentHistory || historyResponse.status === 401 || historyResponse.status === 403) {
      res.status(200).json({
        status: historyResponse.status === 401 || historyResponse.status === 403 ? "reauthorize" : "unavailable",
        tracks: [],
      });
      return;
    }

    let currentTrack: (StoredTrack & { isCurrent: true; currentStatus: string }) | null = null;
    try {
      const playbackResponse = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (playbackResponse.ok) {
        const playback = (await playbackResponse.json()) as {
          is_playing?: boolean;
          progress_ms?: number | null;
          item?: PlaybackItem | null;
        };
        if (playback.item && playback.item.type !== "episode" && (playback.progress_ms ?? 0) >= 10_000) {
          currentTrack = {
            ...mapPlaybackItem(playback.item, new Date().toISOString()),
            isCurrent: true,
            currentStatus: playback.is_playing ? "Now playing" : "Paused",
          };
        }
      }
    } catch {
      // Keep the recent-history results if the current-playback request fails.
    }

    let tracks: Array<StoredTrack & { isCurrent?: true; currentStatus?: string }>;
    if (usePersistentHistory) {
      const storedTracks = await mergeRecentTracks(currentTrack ? [currentTrack, ...recentTracks] : recentTracks);
      tracks = storedTracks.map((track) => currentTrack && track.id === currentTrack.id
        ? { ...track, isCurrent: true, currentStatus: currentTrack.currentStatus }
        : track);
    } else {
      const previousTracks = currentTrack
        ? recentTracks.filter((track) => track.id !== currentTrack.id)
        : recentTracks;
      tracks = currentTrack
        ? [currentTrack, ...previousTracks.slice(0, 4)]
        : recentTracks.slice(0, 5);
    }
    res.status(200).json({ status: "ok", tracks });
  } catch {
    res.status(200).json({ status: "unavailable", tracks: [] });
  }
}
