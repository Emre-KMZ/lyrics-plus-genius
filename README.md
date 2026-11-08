# Lyrics Plus with Genius

Genius lyrics inside Spotify, for songs Spotify has no lyrics for.

This is a fork of [Spicetify](https://spicetify.app/)'s Lyrics Plus custom app with its
Genius provider working again on Spotify 1.3.8+. Genius blocks requests that don't come from
a real browser, so the lyrics are loaded by **your own Chrome** and handed to Spotify through
a small local bridge.

```
Spotify (Lyrics Plus) ──▶ bridge on 127.0.0.1:47123 ◀── Chrome extension ──▶ genius.com
```

- Lyrics Plus tries its sources in order; Genius fills in when the others have nothing.
- Genius lyrics are plain text (no scrolling with the song); click a highlighted line to see
  its Genius annotation.
- Chrome must be open. If it isn't, songs without lyrics simply stay empty.

## Requirements

- macOS, Spotify desktop app, [Spicetify](https://spicetify.app/) (`brew install spicetify-cli`,
  then `spicetify backup apply` once)
- Node.js 18+
- Google Chrome

## Install

```bash
./install.sh
```

It:

1. copies the Lyrics Plus fork to `~/.config/spicetify/CustomApps/lyrics-plus` (an existing
   copy is moved to `~/Library/Application Support/lyrics-plus-genius/backups/`),
2. installs the bridge and a LaunchAgent so it starts at login,
3. enables Lyrics Plus and runs `spicetify apply`.

Then, once, in Chrome: open `chrome://extensions`, turn on **Developer mode**, click
**Load unpacked** and choose this repo's `extension` folder.

In Lyrics Plus settings, check that the **Genius** provider is on.

## After a Spotify update

Spotify updates remove Spicetify's changes. Quit Spotify and run:

```bash
spicetify backup apply
```

## Troubleshooting

- **Bridge running?** `curl http://127.0.0.1:47123/health` should show `"chromeConnected": true`.
  Logs: `~/Library/Logs/lyrics-plus-genius-bridge.log`.
- **"Genius refused the request (403)"**: open genius.com in Chrome once (and complete the
  check if Genius shows one), then play the song again.
- **Lyrics Plus missing from Spotify**: run `spicetify backup apply`.

## Uninstall

```bash
./uninstall.sh
```

Then remove the extension from `chrome://extensions`.

## What changed from upstream Lyrics Plus

See the git history: the first commit is Lyrics Plus from spicetify-cli 2.46.4 unchanged.

- Genius provider re-enabled and routed through the bridge.
- Genius's lyrics header (contributor count, info icon) removed from the lyrics.
- Crash fix when showing Genius lyrics (`currentLyrics.some` on a string).
- No whole-block hover underline on Genius lyrics.
- Local popover menu in place of Spicetify's `ContextMenu`, which crashes on Spotify 1.3.8.

Design notes: [docs/design.md](docs/design.md).

## Security

The bridge listens on 127.0.0.1 only. It accepts requests only from Spotify's page and from
the Chrome extension, and only for the genius.com URLs Lyrics Plus needs (search, lyrics
pages, annotations), so websites open in Chrome can't use it to read genius.com as you.

## Tests

```bash
npm test
```

## License

LGPL-2.1-only, like spicetify-cli, which this is based on. See [LICENSE](LICENSE).
