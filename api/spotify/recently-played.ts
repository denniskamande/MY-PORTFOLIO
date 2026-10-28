import { getSpotifyAccessToken, hasSpotifyRefreshToken, setResponseHeaders, spotifyReconnectRequired, type ApiRequest, type ApiResponse } from "./token";

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
    const response = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      res.status(200).json({ status: response.status === 401 ? "reauthorize" : "unavailable", tracks: [] });
      return;
    }

    const history = (await response.json()) as {
      items?: Array<{
        played_at?: string;
        track?: {
          name?: string;
          artists?: Array<{ name?: string }>;
          album?: { images?: Array<{ url?: string }> };
          external_urls?: { spotify?: string };
        };
      }>;
    };
    const recentTracks = (history.items ?? []).flatMap((item) => {
      if (!item.track) return [];
      return [{
        title: item.track.name ?? "Unknown track",
        artist: item.track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") ?? "",
        image: item.track.album?.images?.[0]?.url ?? null,
        url: item.track.external_urls?.spotify ?? "https://open.spotify.com/",
        playedAt: item.played_at ?? "",
      }];
    });

    let currentTrack: (typeof recentTracks)[number] & { isCurrent: true; currentStatus: string } | null = null;
    try {
      const playbackResponse = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (playbackResponse.ok) {
        const playback = (await playbackResponse.json()) as {
          is_playing?: boolean;
          progress_ms?: number | null;
          item?: {
            name?: string;
            artists?: Array<{ name?: string }>;
            show?: { name?: string; images?: Array<{ url?: string }> };
            album?: { images?: Array<{ url?: string }> };
            external_urls?: { spotify?: string };
          } | null;
        };
        if (playback.item && (playback.progress_ms ?? 0) >= 10_000) {
          currentTrack = {
            title: playback.item.name ?? "Unknown track",
            artist: playback.item.artists?.map((artist) => artist.name).filter(Boolean).join(", ")
              || playback.item.show?.name
              || "Spotify",
            image: playback.item.album?.images?.[0]?.url ?? playback.item.show?.images?.[0]?.url ?? null,
            url: playback.item.external_urls?.spotify ?? "https://open.spotify.com/",
            playedAt: "",
            isCurrent: true,
            currentStatus: playback.is_playing ? "Now playing" : "Paused",
          };
        }
      }
    } catch {
      // Keep the recent-history results if the current playback request fails.
    }

    const previousTracks = currentTrack
      ? recentTracks.filter((track) => track.title !== currentTrack?.title || track.artist !== currentTrack?.artist)
      : recentTracks;
    const tracks = currentTrack
      ? [currentTrack, ...previousTracks.slice(0, 4)]
      : recentTracks.slice(0, 5);
    res.status(200).json({ status: "ok", tracks });
  } catch {
    res.status(200).json({ status: "unavailable", tracks: [] });
  }
}
