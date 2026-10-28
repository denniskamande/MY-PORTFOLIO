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
const RECORD_SCRIPT = [
  "local first = redis.call('LINDEX', KEYS[1], 0)",
  "if not first or cjson.decode(first).id ~= ARGV[1] then",
  "  redis.call('LPUSH', KEYS[1], ARGV[2])",
  "  redis.call('LTRIM', KEYS[1], 0, 4)",
  "end",
  "return redis.call('LRANGE', KEYS[1], 0, 4)",
].join("\n");
const MERGE_SCRIPT = [
  "local tracks = {}",
  "local byId = {}",
  "local function add(serialized)",
  "  local ok, track = pcall(cjson.decode, serialized)",
  "  if not ok or not track or type(track.id) ~= 'string' then return end",
  "  local index = byId[track.id]",
  "  if not index then",
  "    table.insert(tracks, track)",
  "    byId[track.id] = #tracks",
  "  elseif (track.playedAt or '') > (tracks[index].playedAt or '') then",
  "    tracks[index] = track",
  "  end",
  "end",
  "for _, serialized in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do add(serialized) end",
  "for _, serialized in ipairs(ARGV) do add(serialized) end",
  "table.sort(tracks, function(a, b)",
  "  local aTime, bTime = a.playedAt or '', b.playedAt or ''",
  "  if aTime == bTime then return a.id < b.id end",
  "  return aTime > bTime",
  "end)",
  "while #tracks > 5 do table.remove(tracks) end",
  "redis.call('DEL', KEYS[1])",
  "for _, track in ipairs(tracks) do redis.call('RPUSH', KEYS[1], cjson.encode(track)) end",
  "return redis.call('LRANGE', KEYS[1], 0, 4)",
].join("\n");

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

  const response = await fetch(credentials.url + "/multi-exec", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + credentials.token,
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

export async function mergeRecentTracks(tracks: StoredTrack[]): Promise<StoredTrack[]> {
  const serializedTracks = tracks.map((track) => JSON.stringify(track));
  const [result] = await execute([["EVAL", MERGE_SCRIPT, 1, LIST_KEY, ...serializedTracks]]);
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