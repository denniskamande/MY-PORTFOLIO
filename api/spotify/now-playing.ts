import { getSpotifyAccessToken, hasSpotifyRefreshToken, setResponseHeaders, spotifyReconnectRequired, type ApiRequest, type ApiResponse } from "./token";
import { getStoredRecentTracks, hasRecentTrackStore, recordRecentTrack, type StoredTrack } from "./recent-store";

function toStoredTrack(item: NonNullable<PlaybackState["item"]>, playedAt: string): StoredTrack {
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

type PlaybackState = {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: {
    id?: string;
    type?: string;
    name?: string;
    artists?: Array<{ name?: string }>;
    show?: { name?: string; images?: Array<{ url?: string }> };
    album?: { images?: Array<{ url?: string }> };
    external_urls?: { spotify?: string };
  } | null;
};

async function respondWithLastPlayed(token: string, res: ApiResponse): Promise<void> {
  try {
    if (hasRecentTrackStore()) {
      const [storedTrack] = await getStoredRecentTracks();
      if (storedTrack) {
        res.status(200).json({
          status: "paused",
          title: storedTrack.title,
          artist: storedTrack.artist,
          image: storedTrack.image,
          url: storedTrack.url,
        });
        return;
      }
    }
    const response = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      res.status(200).json({ status: response.status === 401 ? "reauthorize" : "idle" });
      return;
    }
    const history = (await response.json()) as {
      items?: Array<{
        track?: {
          name?: string;
          artists?: Array<{ name?: string }>;
          album?: { images?: Array<{ url?: string }> };
          external_urls?: { spotify?: string };
        };
      }>;
    };
    const track = history.items?.find((item) => item.track)?.track;
    if (!track) {
      res.status(200).json({ status: "idle" });
      return;
    }
    const storedTrack: StoredTrack = {
      id: track.external_urls?.spotify ?? track.name ?? "recent-track",
      title: track.name ?? "Unknown track",
      artist: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") ?? "Spotify",
      image: track.album?.images?.[0]?.url ?? null,
      url: track.external_urls?.spotify ?? "https://open.spotify.com/",
      playedAt: new Date().toISOString(),
    };
    if (hasRecentTrackStore()) await recordRecentTrack(storedTrack);
    res.status(200).json({
      status: "paused",
      title: storedTrack.title,
      artist: storedTrack.artist,
      image: storedTrack.image,
      url: storedTrack.url,
    });
  } catch {
    res.status(200).json({ status: "idle" });
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setResponseHeaders(res, 5);
  if (req.method !== "GET") {
    res.status(405).json({ status: "error" });
    return;
  }
  if (!hasSpotifyRefreshToken()) {
    res.status(200).json({ status: "unconfigured" });
    return;
  }

  try {
    const token = await getSpotifyAccessToken();
    if (!token) {
      res.status(200).json({ status: spotifyReconnectRequired() ? "reauthorize" : "unavailable" });
      return;
    }
    const response = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 204) {
      await respondWithLastPlayed(token, res);
      return;
    }
    if (!response.ok) {
      res.status(200).json({ status: response.status === 401 ? "reauthorize" : "unavailable" });
      return;
    }

    const state = (await response.json()) as PlaybackState;
    if (!state.item) {
      await respondWithLastPlayed(token, res);
      return;
    }

    if (hasRecentTrackStore() && state.item.type !== "episode" && (state.progress_ms ?? 0) >= 10_000) {
      try {
        await recordRecentTrack(toStoredTrack(state.item, new Date().toISOString()));
      } catch {
        // Keep the live player working if recent-history storage is unavailable.
      }
    }

    res.status(200).json({
      status: state.is_playing ? "playing" : "paused",
      title: state.item.name ?? "Unknown track",
      artist: state.item.artists?.map((artist) => artist.name).filter(Boolean).join(", ")
        || state.item.show?.name
        || "Spotify",
      image: state.item.album?.images?.[0]?.url ?? state.item.show?.images?.[0]?.url ?? null,
      url: state.item.external_urls?.spotify ?? null,
    });
  } catch {
    res.status(200).json({ status: "unavailable" });
  }
}
