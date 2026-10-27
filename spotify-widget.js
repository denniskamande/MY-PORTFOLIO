const nowPlaying = document.querySelector("#spotify-now");
const recentButton = document.querySelector("#recent-toggle");
const recentList = document.querySelector("#recently-played");
let recentLoaded = false;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function renderMessage(message, allowReconnect = false) {
  if (!nowPlaying) return;
  const copy = node("div", "spotify-copy");
  copy.append(node("p", "spotify-message", message));
  if (allowReconnect) {
    const link = node("a", "spotify-open", "Reconnect Spotify");
    link.href = "/spotify-connect.html";
    copy.append(link);
  }
  nowPlaying.replaceChildren(copy);
}

async function updateNowPlaying() {
  if (!nowPlaying) return;
  try {
    const response = await fetch("/api/spotify/now-playing", { cache: "no-store" });
    const data = await response.json();
    if (data.status === "unconfigured") {
      renderMessage("Spotify is waiting for the owner to connect their account.");
      return;
    }
    if (data.status === "idle") {
      renderMessage("Nothing is playing on Spotify right now.");
      return;
    }
    if (data.status === "reauthorize") {
      renderMessage("The Spotify connection needs to be renewed.", true);
      return;
    }
    if (data.status !== "playing" && data.status !== "paused") {
      renderMessage("Spotify playback is temporarily unavailable.");
      return;
    }

    nowPlaying.replaceChildren();
    if (data.image) {
      const cover = node("img", "spotify-cover");
      cover.src = data.image;
      cover.alt = "";
      cover.loading = "lazy";
      nowPlaying.append(cover);
    }
    const copy = node("div", "spotify-copy");
    copy.append(
      node("p", "spotify-state", data.status === "playing" ? "Now playing" : "Paused"),
      node("p", "spotify-title", data.title),
      node("p", "spotify-artist", data.artist),
    );
    nowPlaying.append(copy);
    if (data.url) {
      const link = node("a", "spotify-open", "Open in Spotify ↗");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      nowPlaying.append(link);
    }
  } catch {
    renderMessage("Spotify playback is temporarily unavailable.");
  }
}

function formatPlayedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function loadRecentTracks() {
  if (!recentList) return;
  recentList.hidden = false;
  if (recentLoaded) return;
  recentList.replaceChildren(node("p", "spotify-message", "Loading recent tracks…"));
  try {
    const response = await fetch("/api/spotify/recently-played", { cache: "no-store" });
    const data = await response.json();
    if (data.status === "unconfigured") {
      recentList.replaceChildren(node("p", "spotify-message", "Recent tracks will appear after the owner connects Spotify."));
      return;
    }
    if (data.status === "reauthorize") {
      const message = node("p", "spotify-message", "The Spotify connection needs to be renewed. ");
      const link = node("a", "", "Reconnect Spotify");
      link.href = "/spotify-connect.html";
      message.append(link);
      recentList.replaceChildren(message);
      return;
    }
    if (data.status !== "ok") {
      recentList.replaceChildren(node("p", "spotify-message", "Recent listening history is temporarily unavailable."));
      return;
    }
    recentList.replaceChildren();
    if (data.tracks.length === 0) {
      recentList.append(node("p", "spotify-message", "No recent tracks to show."));
    }
    recentList.append(node("p", "recent-heading", "Last 5 played"));
    data.tracks.forEach((track) => {
      const row = node("div", "recent-track");
      if (track.image) {
        const cover = node("img", "recent-cover");
        cover.src = track.image;
        cover.alt = "";
        cover.loading = "lazy";
        row.append(cover);
      } else {
        row.append(node("div", "recent-cover empty"));
      }
      const info = document.createElement("a");
      info.href = track.url;
      info.target = "_blank";
      info.rel = "noreferrer";
      info.append(node("strong", "", track.title), node("small", "", track.artist));
      const playedAt = node("time", "recent-time", formatPlayedAt(track.playedAt));
      if (track.playedAt) playedAt.dateTime = track.playedAt;
      row.append(info, playedAt);
      recentList.append(row);
    });
    recentLoaded = true;
  } catch {
    recentList.replaceChildren(node("p", "spotify-message", "Recent listening history is temporarily unavailable."));
  }
}

recentButton?.addEventListener("click", async () => {
  const open = recentButton.getAttribute("aria-expanded") !== "true";
  recentButton.setAttribute("aria-expanded", String(open));
  recentButton.querySelector("span")?.replaceChildren(document.createTextNode(open ? "−" : "＋"));
  if (open) await loadRecentTracks();
  else if (recentList) recentList.hidden = true;
});

updateNowPlaying();
window.setInterval(updateNowPlaying, 30_000);
