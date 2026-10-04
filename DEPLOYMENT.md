# Run ProgressPoint without your computer

ProgressPoint is prepared for deployment but has **not been published**. Localhost works only while your computer and server process are running. An always-on host with a persistent disk runs independently of your browser or computer.

## Choose either hosting shape

1. **Managed container / Node host with persistent disk:** run one instance of the app with Node.js 24+ or the included Dockerfile. Mount a private, persistent directory at `/data`. Set `DATA_DIR=/data`, `HOST=0.0.0.0`, and `PUBLIC_URL` to the HTTPS address assigned by the host. Use the platform’s port variable or `PORT=3000`. Route health checks to `/api/health`. Disable sleeping/scale-to-zero if continuous availability matters.
2. **Always-on Linux server with Docker Compose:** use the included app container and Caddy HTTPS proxy, following the steps below.

Do not use static-only hosting, an ephemeral filesystem, or multiple app replicas for this SQLite version. A single instance with a durable volume is the intended deployment.

No domain purchase is needed to develop. A managed host’s assigned HTTPS URL can be used as `PUBLIC_URL`. The name ProgressPoint does not require a matching domain. Replace the placeholder later.

## Compose deployment with a domain

On your host, install Docker and Docker Compose, clone this repository, and create a private `.env` file:

```dotenv
PUBLIC_URL=https://progresspoint.example.com
SITE_ADDRESS=progresspoint.example.com
# Optional, only when ready:
# OPENAI_API_KEY=...
# GEMINI_API_KEY=...
# COMPATIBLE_API_KEY=...
# COMPATIBLE_BASE_URL=https://your-provider.example/v1
```

`progresspoint.example.com` is a placeholder, not a registered destination. Substitute the real domain, point its DNS to your server, and allow incoming TCP 80/443.

```sh
docker compose up -d --build
docker compose ps
```

Caddy handles HTTPS. The app’s `restart: unless-stopped` policy brings it back after a server reboot when Docker itself starts at boot. SQLite and HTTPS certificates live in named volumes. Never run `docker compose down -v` on a live deployment unless you intend to erase those volumes.

Retrieve the first tutor link privately:

```sh
docker compose exec app cat /data/tutor-access.txt
```

Open it yourself, add a student, and share the newly generated student/parent links directly. Share neither the tutor link nor the contents of your server’s environment file.

## Moving from local to hosted

Stop the local app and make a consistent backup first. Restore it to the host’s `/data/tutoring.sqlite` before first launch, with ownership allowing the container’s `node` user to write it. Alternatively, start clean on the host and import your question bank JSON.

Set `PUBLIC_URL` to the actual HTTPS host. Existing links need their URL origin changed to the new host while retaining the same token fragment, or can be replaced from Students. The stored first tutor-link file may still have the old origin; recover a fresh tutor link with the script below if necessary.

## Backups

```sh
docker compose exec app node scripts/backup.mjs
```

This creates a consistent `/data/backups/progresspoint-<timestamp>.sqlite` snapshot while the app runs. Arrange a daily host/platform backup job and copy snapshots to private off-host storage. The application does not install a scheduler or buy storage for you. Set a retention period that fits your needs; student deletion does not rewrite earlier exports or backup snapshots.

To recover tutor access:

```sh
docker compose exec app node scripts/reset-tutor.mjs
docker compose exec app cat /data/tutor-access.txt
```

This revokes every older tutor link and session.

## Restore

1. Stop the app service so no connection writes to the database.
2. Preserve the current database, its `-wal`/`-shm` sidecars, and the intended backup separately before replacing anything.
3. Restore the selected consistent backup as `tutoring.sqlite` in the persistent data directory. Move aside stale WAL/SHM sidecars from the previous database rather than pairing them with the restored file.
4. Start the app, verify the health check, and privately open tutor access.
5. If the saved tutor link is from a different database state, use `scripts/reset-tutor.mjs`.
6. Confirm a student’s records and an assignment before reopening access.

Backups include all workspace records and hashed access tokens. Protect them like the live database.

## Updates and limits

Run tests before deploying an update. Back up first, then use `docker compose up -d --build`. The persistent volume remains in place.

The app passes local integration and browser tests. The Docker image has been built and smoke-tested for HTTP endpoints, math assets, and SQLite persistence. Provider calls are tested with mock responses. No provider credentials or hosting service were supplied, so live LLM calls and public HTTPS provisioning remain untested. The local preview is not the always-on deployment.

Question generation and writing grading use your provider key. Configure provider spending limits as well as the app’s request cap. Review the privacy text with your actual hosting and tutoring practices before inviting real learners; the app does not establish regulatory compliance by itself.
