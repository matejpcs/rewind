# Rewind

A self-hosted music library with the brushed-metal look and compact controls of a classic desktop music player. Rewind reads tags and embedded cover art, streams tracks in the browser, and supports adding music either by uploading files or placing them in the server folder.

## Start it on your server

1. Copy this project to the server and install Docker Engine with the Compose plugin.
2. In this folder, create your settings file:

   ```sh
   cp .env.example .env
   ```

3. Edit `.env`: set `APP_PASSWORD` to your library login password and replace `SECRET_KEY` with a random value. For example, generate one with `openssl rand -hex 32`.
4. Create the music folder, then make it writable by the user configured by `PUID` and `PGID` in `.env` (defaults are `1000:1000`):

   ```sh
   mkdir -p music
   chown -R 1000:1000 music
   ```

   If you already have a music folder, put your collection there instead. You can also change `PUID` and `PGID` to match its owner.
5. Start the app:

   ```sh
   docker compose up -d --build
   ```

6. Open `http://YOUR-SERVER:8088` from your network and sign in with `APP_PASSWORD`.

The app starts with login enabled. Keep `.env` private. The password is sent over HTTP on a plain local network; if you make the app available beyond a trusted network, put it behind an HTTPS reverse proxy and set `COOKIE_SECURE=1`.

## Add music

- **Upload from the browser:** choose **Add Music** or drag audio files onto the page. Uploads are saved under `music/Uploads/` and stay on disk when the container is recreated.
- **Use your existing collection:** copy files or folders into `music/`, then choose **Refresh**. Subfolders are scanned automatically.

Supported formats include MP3, FLAC, M4A/M4B/AAC, OGG, Opus, WAV, AIFF, WMA, APE, ALAC, DSF/DFF, Matroska audio, Musepack, Speex, TTA, WavPack, CAF, AC-3, AMR, 3GP, and WebM audio. Metadata scanning supports more formats than a given browser can play; playback still depends on browser codec support. Tracks with readable tags show their title, artist, album, year, genre, duration, and embedded cover art. Untagged tracks use the filename and a simple fallback cover.

Open a song list and hover a track to find the pencil button. Rewind lets you edit the title, artist, album, album artist, genre, year, and track number in the browser, then saves those tags back into the original audio file. Some container or codec formats expose read-only tags; Rewind reports that limitation without changing the file.

The interface uses the Material Symbols Rounded icon font, scales from a desktop window down to phones, and switches the library navigation to a compact horizontal bar on narrow screens.

The **Albums**, **Songs**, **Artists**, and **Genres** views, search, shuffle/repeat, volume, seeking, and browser-local playlists are included. Playlists are stored in that browser and do not modify the source music files.

## Useful commands

```sh
docker compose logs -f
docker compose restart
docker compose down
```

The library data lives in `./music`; the app itself is stateless. Back up that folder and your `.env` file.
