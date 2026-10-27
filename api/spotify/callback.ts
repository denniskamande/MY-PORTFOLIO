type Request = { method?: string };
type Response = {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  send(body: string): void;
};

export default function handler(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <title>Spotify authorization | Chege Dennis Kamande</title>
    <link rel="stylesheet" href="/style.css" />
    <script src="/spotify-connect.js" defer></script>
  </head>
  <body>
    <main class="page connect-page">
      <header class="intro">
        <p class="subname">Spotify setup</p>
        <h1>Finish connecting Spotify</h1>
        <p class="muted" id="auth-status" role="status" aria-live="polite">Checking your Spotify sign-in…</p>
        <div id="token-result" hidden>
          <label for="refresh-token">Refresh token</label>
          <textarea class="token-output" id="refresh-token" readonly aria-label="Spotify refresh token"></textarea>
          <button class="copy-token" id="copy-token" type="button">Copy refresh token</button>
          <p class="muted">In Vercel, add an environment variable named <code>SPOTIFY_REFRESH_TOKEN</code> with this value, then redeploy. Keep this token private and close this page after copying it. Spotify may require you to reconnect after the token expires or changes.</p>
        </div>
      </header>
    </main>
  </body>
</html>`);
}
