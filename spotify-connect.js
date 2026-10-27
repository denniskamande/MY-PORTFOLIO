const SPOTIFY_CLIENT_ID = "147e9f9a3549421885b8b8a85ba72b05";
const REDIRECT_URI = "https://kamande.vercel.app/api/spotify/callback";
const SCOPES = "user-read-playback-state user-read-recently-played";

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function randomValue(size) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function createChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function startAuthorization(button, status) {
  button.disabled = true;
  status.textContent = "Preparing secure Spotify sign-in…";
  const verifier = randomValue(64);
  const state = randomValue(24);
  sessionStorage.setItem("spotify_pkce_verifier", verifier);
  sessionStorage.setItem("spotify_oauth_state", state);

  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge_method: "S256",
    code_challenge: await createChallenge(verifier),
  }).toString();
  window.location.assign(authorize);
}

async function finishAuthorization(status) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  window.history.replaceState({}, document.title, window.location.pathname);

  if (error) {
    status.textContent = "Spotify authorization was cancelled or could not be completed.";
    return;
  }
  if (!code) {
    status.textContent = "Use the button above to connect your Spotify account.";
    return;
  }

  const expectedState = sessionStorage.getItem("spotify_oauth_state");
  const verifier = sessionStorage.getItem("spotify_pkce_verifier");
  sessionStorage.removeItem("spotify_oauth_state");
  sessionStorage.removeItem("spotify_pkce_verifier");
  if (!state || state !== expectedState || !verifier) {
    status.textContent = "This sign-in session expired. Start again from the connect button.";
    return;
  }

  status.textContent = "Finishing Spotify connection…";
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.refresh_token) {
    status.textContent = "Spotify did not return a refresh token. Please start the connection again.";
    return;
  }

  const tokenField = document.querySelector("#refresh-token");
  const result = document.querySelector("#token-result");
  const connectButton = document.querySelector("#connect-spotify");
  if (tokenField && result) {
    tokenField.value = tokenData.refresh_token;
    result.hidden = false;
  }
  if (connectButton) connectButton.hidden = true;
  status.textContent = "Spotify approved access. Copy the token below into Vercel.";
}

const status = document.querySelector("#auth-status");
const connectButton = document.querySelector("#connect-spotify");
connectButton?.addEventListener("click", () => {
  if (status) startAuthorization(connectButton, status).catch(() => {
    connectButton.disabled = false;
    status.textContent = "Could not start Spotify sign-in. Please try again.";
  });
});

if (status && window.location.pathname === "/api/spotify/callback") {
  finishAuthorization(status).catch(() => {
    status.textContent = "Could not finish Spotify sign-in. Please start again.";
  });
}

document.querySelector("#copy-token")?.addEventListener("click", async () => {
  const tokenField = document.querySelector("#refresh-token");
  const button = document.querySelector("#copy-token");
  if (!tokenField || !button) return;
  tokenField.focus();
  tokenField.select();
  try {
    await navigator.clipboard.writeText(tokenField.value);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Selected — copy the token";
  }
});
