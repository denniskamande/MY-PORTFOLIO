declare const process: { env: Record<string, string | undefined> };

export type ApiRequest = { method?: string };
export type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
};

export const spotifyClientId = "147e9f9a3549421885b8b8a85ba72b05";
let accessToken = "";
let expiresAt = 0;
let reconnectRequired = false;

export function hasSpotifyRefreshToken(): boolean {
  return Boolean(process.env.SPOTIFY_REFRESH_TOKEN);
}

export function spotifyReconnectRequired(): boolean {
  return reconnectRequired;
}

export async function getSpotifyAccessToken(): Promise<string | null> {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) return null;
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: spotifyClientId,
    }),
  });
  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok) {
    if (result.error === "invalid_grant") reconnectRequired = true;
    return null;
  }
  if (result.refresh_token && result.refresh_token !== refreshToken) {
    reconnectRequired = true;
    return null;
  }
  if (!result.access_token) return null;
  accessToken = result.access_token;
  expiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
  return accessToken;
}

export function setResponseHeaders(res: ApiResponse, maxAge = 15): void {
  res.setHeader("Cache-Control", `public, s-maxage=${maxAge}, stale-while-revalidate=10`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}
