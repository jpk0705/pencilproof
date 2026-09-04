# PencilProof YouTube upload scaffold

`scripts/youtube-uploader.mjs` turns an existing `content/organic/*.md` YouTube
Short or explainer section into YouTube metadata and, only when explicitly
requested, performs a resumable upload through the YouTube Data API.

## Safe local workflow

The default is a local dry run. It reads the selected Markdown file and prints
metadata only; it does not inspect credential values or contact Google.

```text
node scripts/youtube-uploader.mjs --content content/organic/amount-financed-higher-than-price.md --format short --video .\media\amount-financed-short.mp4
```

Uploads are intentionally gated behind `--upload`, a configured installed-app
client ID, a persisted refresh token, and a matching
`YOUTUBE_EXPECTED_CHANNEL_ID`. The script refreshes a short-lived access token
immediately before the upload, verifies the OAuth identity's channel, and only
then opens a resumable upload session. It never prints, persists, or includes
access-token values in error output or the JSON result.

Authorize the Google installed app with PKCE and a loopback callback first:

```text
node scripts/youtube-uploader.mjs --authorize
```

The client ID is read from `YOUTUBE_CLIENT_ID`. For a Google desktop OAuth
client JSON, pass its absolute path with `--client-config-path` or
`YOUTUBE_CLIENT_CONFIG_PATH`; the script uses its client ID and secret only in
token requests, and never prints or persists the JSON or secret. Client-ID-only
operation remains supported.
The refresh token is stored with restrictive file permissions in the default
per-user config directory outside this repository, or at an explicit absolute
`--refresh-token-path`.

```text
node scripts/youtube-uploader.mjs --content content/organic/amount-financed-higher-than-price.md --format short --video .\media\amount-financed-short.mp4 --upload
```

`private` is the default privacy state. Review the title, description,
audience declaration, thumbnail, captions, and final channel binding before
any owner-authorized upload. `public` publishing is not enabled by default and
is not part of local verification.

The uploader is intentionally separate from the scheduled social Worker. It
does not add YouTube to the existing direct social cron, and it does not
publish or deploy automatically.

## Secret handling

Do not place OAuth client JSON, client secrets, refresh tokens, access tokens,
or channel credentials in Git, Markdown content, shell history, CI logs, or
chat. The supported environment names are `YOUTUBE_CLIENT_ID` and
`YOUTUBE_EXPECTED_CHANNEL_ID`; custom names can be supplied with
`--client-env` and `--channel-env`. Values remain in the process and are never
shown by the CLI. Only the refresh token is persisted, and only outside the
repository or at an explicit absolute path.
