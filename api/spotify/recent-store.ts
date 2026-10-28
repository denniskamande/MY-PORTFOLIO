declare const process: { env: Record<string, string | undefined> };

export type StoredTrack = {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  url: string;
  playedAt: string;
};

const LIST_KEY = "portfolio:spotify:recently-played:v1";
const SEED_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  for i = 1, #ARGV do redis.call('LPUSH', KEYS[1], ARGV[i]) end
  redis.call('LTRIM', KEYS[1], 0, 4)
end
return redis.call('LRANGE', KEYS[1], 0, 4)
`;
const RECORD_SCRIPT = `
local first = redis.call('LINDEX', KEYS[1], 0)
if not first or cjson.decode(first).id ~= ARGV[1] then
  redis.call('LPUSH', KEYS[1], ARGV[2])
  redis.call('LTRIM', KEYS[1], 0, 4)
end
return redis.call('LRANGE', KEYS[1], 0, 4)
`;

function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function hasRecentTrackStore(): boolean {
  return redisCredentials() !== null;
}

async function execute(commands: unknown[][]): Promise<unknown[]> {
  const credentials = redisCredentials();
  if (!credentials) throw new Error("Recent track storage is not configured");

  const response = await fetch(`${credentials.url}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error("Recent track storage request failed");

  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(results) || results.some((result) => result.error)) {
    throw new Error("Recent track storage returned an invalid response");
  }
  return results.map((result) => result.result);
}

function parseTracks(value: unknown): StoredTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((serialized) => {
    if (typeof serialized !== "string") return [];
    try {
      const track = JSON.parse(serialized) as StoredTrack;
      return track && typeof track.id === "string" && typeof track.title === "string" ? [track] : [];
    } catch {
      return [];
    }
  });
}

export async function getStoredRecentTracks(): Promise<StoredTrack[]> {
  const [result] = await execute([["LRANGE", LIST_KEY, 0, 4]]);
  return parseTracks(result);
}

export async function seedRecentTracks(tracks: StoredTrack[]): Promise<StoredTrack[]> {
  const ordered = [...tracks].reverse().map((track) => JSON.stringify(track));
  const [result] = await execute([["EVAL", SEED_SCRIPT, 1, LIST_KEY, ...ordered]]);
  return parseTracks(result);
}

export async function recordRecentTrack(track: StoredTrack): Promise<StoredTrack[]> {
  const storedTrack = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    image: track.image,
    url: track.url,
    playedAt: track.playedAt,
  };
  const [result] = await execute([[
    "EVAL",
    RECORD_SCRIPT,
    1,
    LIST_KEY,
    track.id,
    JSON.stringify(storedTrack),
  ]]);
  return parseTracks(result);
}
