# Lyrics Plus with Genius — design

Date: 2026-11-07

## Why

Spotify has no lyrics for many songs, especially Turkish underground releases
(example: "Crash//Out" by Se7en of 34, sulga & SANC). LRCLIB, Musixmatch and Netease often
don't have them either, but Genius usually does.

Lyrics Plus (the Spicetify custom app) used to have a Genius provider. It has been
disabled since Spotify 1.2.31 because:

1. The Spotify-internal request function it used no longer works.
2. Genius puts genius.com behind Cloudflare bot protection, so any non-browser request
   (Spotify, curl, a local script) gets `403 cf-mitigated: challenge`.

A normal browser that the user is already using passes Genius without a challenge. So
the user's own Chrome loads the Genius pages, and Spotify gets the result.

## Goals

- When Spotify (or another enabled source) has no lyrics, Lyrics Plus shows Genius
  lyrics in the same place, including annotations on click.
- Works on the user's Mac with Spotify 1.3.8+ and Spicetify 2.46+.
- Starts by itself at login; the user does nothing day to day apart from keeping Chrome open.

## Non-goals

- Synced (scrolling) Genius lyrics: Genius has no timing data.
- Windows/Linux, other browsers, Chrome Web Store publishing.
- Surviving Spotify updates on its own: after an update the user runs
  `spicetify backup apply` (this is true for all Spicetify mods).

## Anti-goals

- No getting past Cloudflare by automation (headless browsers, cookie harvesting, faking a
  browser fingerprint). Genius is only ever loaded by the user's real Chrome. If Genius
  shows a challenge, the user solves it by visiting genius.com once.
- The bridge must not turn into a way for any website to read genius.com as the user.

## Parts

```
Spotify (Lyrics Plus fork) ──GET /genius?url=…──▶ bridge (127.0.0.1:47123) ◀──long-poll /next── Chrome extension
                           ◀────── JSON text ───                           ──POST /result──▶   (fetches genius.com)
```

1. **Lyrics Plus fork** (`custom-app/lyrics-plus`): based on the Lyrics Plus that ships with
   spicetify-cli 2.46.4. It installs under the same name, so it replaces the bundled one
   and keeps the same route (`/lyrics-plus`) and settings. Changes from upstream:
   - Remove the four "Genius is disabled on 1.2.31+" checks.
   - Genius requests (search, page, annotations) go to the bridge instead of
     `CosmosAsync` / `sendCosmosRequest`.
   - Drop Genius's new lyrics header (`[data-exclude-from-selection]` inside the lyrics
     container) when reading lyrics.
   - Fix a crash: `currentLyrics.some` is called on Genius lyrics, which are an HTML string.
   - Genius lyrics block gets a `lyrics-Genius-lyrics` class; the whole-block hover underline
     is turned off for it (annotation links keep their own hover style).
   - The user's own fix: a local popover menu in place of Spicetify's `ContextMenu`, which
     crashes on Spotify 1.3.8.
2. **Bridge** (`bridge/bridge.mjs`): a dependency-free Node HTTP server bound to
   127.0.0.1:47123. Spotify asks for a genius.com URL; the bridge queues a job, hands it to
   the extension through a long-poll, and returns the extension's answer. Started by a
   launchd LaunchAgent at login and kept alive.
3. **Chrome extension** (`extension/`, Manifest V3, loaded unpacked): long-polls the bridge,
   fetches the URL with Chrome (cookies included, so a passed Cloudflare check carries over),
   posts the text back.
4. **Installer** (`install.sh`, `uninstall.sh`): copies the custom app into
   `~/.config/spicetify/CustomApps/lyrics-plus`, copies the bridge into
   `~/Library/Application Support/lyrics-plus-genius/`, installs and loads the LaunchAgent,
   runs `spicetify apply`, and prints the steps for loading the Chrome extension.

## Security

The bridge only accepts what each side needs:

- `/genius` only from Spotify's page origin (`https://xpui.app.spotify.com`). CORS allows
  only that origin.
- `/next` and `/result` only from a `chrome-extension://` origin.
- Only these genius.com URLs are accepted, in the bridge and again in the extension:
  `/api/search/song?…`, `/api/annotations/<id>`, `/api/referents/<id>`, and lyrics pages
  `/<slug>-lyrics`. Anything else (account pages, other sites) is refused.
- It listens on 127.0.0.1 only.

A local program could still fake an Origin header, but a local program can already reach
genius.com directly; the checks stop web pages open in Chrome from using the bridge.

## Behaviour details

- Job timeout: 20 s → `504` with a message saying Chrome or the extension isn't connected.
- Long-poll: 25 s, then an empty answer and the extension polls again. An MV3 service worker
  can be stopped by Chrome, so an alarm every 30 s restarts polling.
- Logs: `~/Library/Logs/lyrics-plus-genius-bridge.log`.

## Testing

- Bridge: `node --test` (no dependencies) covers job round trip, URL allowlist, origin
  checks, CORS preflight and timeout.
- End to end on the user's Mac: Spotify → bridge → Chrome → Genius with a song that only
  Genius has, plus the Genius tab rendering without a crash, header or block underline.

## Builder's calls (made by Claude, not by the user)

- Same app name as upstream (replaces the bundled Lyrics Plus) instead of a renamed copy.
- No background-tab fallback in the extension: plain `fetch` worked in testing; a tab
  fallback would be untested code. If Cloudflare starts challenging, the fix is to open
  genius.com in Chrome once.
- License LGPL-2.1-only, the same as spicetify-cli, since most of the code is its Lyrics Plus.
- GitHub repo is private by default.
