# Nearby Worker: Run and Host

## Choose a host for the database

The existing Render blueprint is for PostgreSQL. Render Free has an ephemeral filesystem, so do not use its free web service with the local SQLite database if user changes must persist. Use the Render instructions below only after an intentional PostgreSQL migration.

To keep SQLite for now, use a WSGI host whose current plan explicitly preserves files in your account's home directory across restarts and redeploys. PythonAnywhere is one possible beginner-oriented host; check its current free-plan availability and filesystem limits before creating an account. Do not assume a free host has persistent storage.

The app now allows production SQLite only when `NEARBY_ALLOW_PERSISTENT_SQLITE=1`, `NEARBY_DATABASE_URL` points to an absolute SQLite database path, and that file already exists. This opt-in does not make ephemeral storage safe.

## Deploy from Windows 10

These steps describe the PostgreSQL/Render route only. For SQLite-preserving hosting, follow the WSGI-host section below instead.

1. Create a GitHub account if you do not already have one, and install Git for Windows. These are actions for you; this project has not been published and no accounts have been created for you.
2. In the project folder, check that `.env`, `.env.*` other than `.env.example`, and database files are not staged. `.gitignore` already excludes them. Do not push local database contents unless you explicitly intend to migrate them.
3. Create a private or public GitHub repository and push the project using GitHub Desktop, or use Git from PowerShell:

	```powershell
	git init
	git add .
	git status
	git commit -m "Prepare Nearby Worker deployment"
	git branch -M main
	git remote add origin YOUR_GITHUB_REPOSITORY_URL
	git push -u origin main
	```

	Review `git status` before committing. Never paste a password, database URL, or JWT secret into source files or chat.
4. Create a Neon project using its Free plan. Copy the pooled PostgreSQL connection string from Neon’s dashboard; treat it as a password. Do not put the real value in `render.yaml`, `.env.example`, GitHub, or a message.
5. In Render, choose **New → Blueprint**, connect the repository, and review the `nearby-worker` service. The blueprint uses `pip install -r requirements.txt` and `gunicorn --config gunicorn.conf.py wsgi:app`. It sets `APP_ENV=production`, asks Render to generate `JWT_SECRET_KEY`, and marks `NEARBY_DATABASE_URL` as a dashboard-only value (`sync: false`). Automatic deploys are disabled.
6. When Render asks for `NEARBY_DATABASE_URL`, enter the Neon connection string in Render's private environment-variable form. If the blueprint has already been created, open the service's **Environment** settings and add/update that variable there. Never add it to a committed file.
7. Create the service and allow its first build/deploy. Open the Render-provided URL and check both `/` and `/api/health`. The free web service can sleep while idle; the first visit after sleep may be slow.

If you prefer a single provider, Render can host the web service and Postgres, but Render's Free Postgres currently expires 30 days after creation. It is therefore not a persistent forever-free database option.

## Safe local run

From PowerShell in the project folder:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000/`. Local development defaults to SQLite at `instance/nearby_worker.db`. Local secrets can be set in your shell or in an ignored `.env` file; the app does not automatically load `.env`, so set variables in PowerShell or use a local dotenv tool only if you intentionally add one. `.env.example` contains placeholders, not working credentials.

## Keep SQLite on a persistent WSGI host

1. Confirm that the hosting plan preserves files in the account home directory over restarts and redeploys. If it does not, stop; local SQLite is not safe on that plan.
2. Upload the project to a private application directory, not a public static-files directory. Install the dependencies in the host's supported virtual environment.
3. Upload a copy of the verified SQLite backup to the application's `instance/nearby_worker.db` path. Keep the original local database and backup unchanged. Never commit or publicly serve this file.
4. In the host's private WSGI/environment configuration, set `APP_ENV=production`, `NEARBY_ALLOW_PERSISTENT_SQLITE=1`, `NEARBY_DATABASE_URL` to the absolute path of the uploaded database, and `JWT_SECRET_KEY` to a long random secret. Set these before importing the application; do not put them in Git.
5. Configure the WSGI callable as `application`. The repository's `wsgi.py` exports both `application` and `app`.
6. Configure the host to serve `/static/` from this project's `static` directory, then reload the WSGI app.
7. Check the public homepage and `/api/health`. Confirm the configured database path points to persistent storage before permitting real registrations or bookings.

Startup creates missing tables and additively seeds sample catalogue/workers; it does not delete existing rows. Compare row counts before and after the first startup. If the configured database path is wrong or the file is missing, production startup now fails rather than silently creating a new SQLite database.

## Database persistence and existing records

- Production requires `JWT_SECRET_KEY` and an explicit database URL. PostgreSQL is the default hosting path. SQLite additionally requires `NEARBY_ALLOW_PERSISTENT_SQLITE=1`, an absolute file path, and an existing database file.
- The preferred environment variable for this project is `NEARBY_DATABASE_URL`. The app also accepts `DATABASE_URL` and normalizes common `postgres://` and `postgresql://` URLs to the installed `psycopg` driver.
- Keep database URLs and JWT secrets only in the host's private environment settings. Let a host generate `JWT_SECRET_KEY`; if setting one yourself, use a long random value and never reuse the development fallback.
- Deploying the app does not copy the local `instance/nearby_worker.db` to Neon. The app creates missing tables and seeds catalogue/sample rows, but existing users, workers, bookings, and reviews require an intentional database migration/export-import. Back up the local database before any migration and verify row counts afterward. Do not overwrite either database as a shortcut.
- Render Free does not provide persistent disks. Use SQLite only on a host with confirmed persistent storage; otherwise migrate intentionally to PostgreSQL first.
- `db.create_all()` creates missing tables but does not migrate existing columns. Add Flask-Migrate before future production schema changes.

## Dependencies and remaining limits

`requirements.txt` includes Flask, Flask-SQLAlchemy, Flask-JWT-Extended, Flask-Cors, Werkzeug, Gunicorn, and Psycopg. Gunicorn serves the WSGI app in production; Psycopg is the PostgreSQL driver. No paid API is required.

The current app is still a prototype: phone numbers are not verified, passwords cannot be reset, there is no rate limiting, and CORS allows cross-origin requests. Restrict CORS and add abuse protection before handling real customer data. Worker and parts prices are example estimates and must be confirmed before work begins.
