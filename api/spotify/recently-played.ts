import { getSpotifyAccessToken, hasSpotifyRefreshToken, setResponseHeaders, spotifyReconnectRequired, type ApiRequest, type ApiResponse } from "./token";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setResponseHeaders(res, 30);
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
    const tracks = (history.items ?? []).flatMap((item) => {
      if (!item.track) return [];
      return [{
        title: item.track.name ?? "Unknown track",
        artist: item.track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") ?? "",
        image: item.track.album?.images?.[0]?.url ?? null,
        url: item.track.external_urls?.spotify ?? "https://open.spotify.com/",
        playedAt: item.played_at ?? "",
      }];
    });
    res.status(200).json({ status: "ok", tracks });
  } catch {
    res.status(200).json({ status: "unavailable", tracks: [] });
  }
}
