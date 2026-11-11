# FAVO on a free host (interim kit)

> **UNTESTED.** This kit was written on a computer without Docker, so nothing in it has been run. Expect to fix small things on the first try. Only the file syntax was checked.

## 1. What this is, and what it is not

**It is** a stand-in: one folder that starts FAVO and its database on any machine that runs Docker, for free, so people can try the app now.

**It is not** the real plan. The plan of record is `docs/FAVO_PRD_v7.md` section 9: an always-on VM on Transformate, Postgres on the same host, secrets in Infisical, `favo.hofmi.net`, continuous backups. OPEN-08 (who is responsible if the server dies on a Sunday) is still unanswered and still blocks going live. See `docs/GO_LIVE_RUNBOOK.md`.

What this kit does **not** give you:

- **No real backups.** The nightly dump below loses up to a day. The PRD (section 9.4) requires losing at most 5 minutes. It does **not** meet that.
- **No card payments.** The live Yoco connection is not built. Sunday card sales stay on the physical Yoco machine.
- **No monitoring and no one on the hook** if it stops.

Use it for a pilot, a demo, or practice. Do not retire the paper and the Yoco machine because of it.

## 2. Why "sleeping" free web hosts will not work

Many free hosts stop your app when nobody is using it, or run it as short-lived functions. FAVO cannot live there. The scheduler (`src/server/jobs`: low stock, the nightly close, the weekly report) runs **inside** the app and needs it running all the time. The barista queue board keeps one connection open for the whole shift (PRD 9.1 calls this non-negotiable). Anything that spins down will miss jobs and freeze the board. You need a machine that is **always on**.

## 3. Pick where it runs

**Option A: an always-free cloud VM** (for example Oracle Cloud "Always Free" Ampere or AMD VM). Be honest with yourself about the catches. Sign-up needs a bank card. Free capacity is sometimes not available in your region, and you may have to retry for days. Free terms change, and accounts that look idle can be reclaimed. **Check the current terms yourself before relying on it.** Install Docker on the VM (Docker's own install guide for your Linux version), then follow section 4 on the VM. The Ampere VM is ARM; the published image may be built for Intel only. If it will not start with a "platform" error, build locally on the VM (section 5, way 2) instead of pulling.

**Option B: a Mac or PC that stays on.** Install Docker Desktop, follow section 4 on it, and use the free Cloudflare quick tunnel for an https address. Good for a pilot only: if the computer sleeps, restarts or loses its wifi, FAVO is down. Turn off sleep. A Mac laptop on a counter is not a server.

Either way, https is needed for the phone app and push notifications. The kit gives you two free ways: a **quick tunnel** (no account, random address that changes on every restart, pilot only) or a **named tunnel** (a free Cloudflare account and a domain on it, stable address). Both need no open ports.

## 4. First run, in order

You need a technical friend for steps 1, 2 and 5.

1. **Get the files.** Download or clone the repository. Open a terminal in the `deploy/free-host` folder.
2. **Create your settings.** Copy `.env.example` to `.env` and fill it in. Make the two secrets yourself on the machine (for example `openssl rand -hex 24` for the database password and `openssl rand -base64 32` for the staff-login secret). Set `AUTH_URL` and `PUBLIC_BASE_URL` to the https address people will use. With a quick tunnel you do not know it yet: put `https://your-host` for now and fix it in step 6. Leave `YOCO_SECRET_KEY` empty. **Never paste your `.env` or any value from it into chat, email or a ticket.**
3. **Start it.** Run `docker compose up -d` (add `--profile quicktunnel` or `--profile tunnel` for https). The first start downloads the images and can take minutes.
4. **Wait for the migration.** Run `docker compose logs -f app` and wait for `[migrate] done` followed by the server starting. **If instead it stops with a `[migrate] FATAL` line asking for approval, see section 7 (migrations).** On a brand-new empty database that is expected: ten migrations are marked as needing approval, so the first start needs `FAVO_APPROVE_MIGRATION` set (section 7).
5. **First load of the empty database** (menu, prices, recipes, ingredient costs and the first admin; it loads no stock). Type the admin PIN without it being saved in your shell history, then run it:

   ```
   read -rs FIRST_ADMIN_PIN; export FIRST_ADMIN_PIN
   docker compose run --rm -e FIRST_ADMIN_PIN app bun first-load.js
   ```

   The PIN must be 4 to 6 digits and not an easy one (such as 1234 or 0000). The command refuses to run once any order exists, and it is safe to run again until then. It prints what it loaded and a list of things to check (placeholder supplier names, costs that are estimates, the Chai Latte price). Read it. Details: `docs/GO_LIVE_RUNBOOK.md` section 3.
6. **Fix the address.** If you used a quick tunnel, find the address with `docker compose logs quicktunnel | grep trycloudflare`, put it in `AUTH_URL` and `PUBLIC_BASE_URL` in `.env`, then run `docker compose up -d` again. Do this again after every tunnel restart.
7. **Sign in** at `<your address>/staff/login` with the admin PIN. Add the baristas at `/admin/staff`.
8. **Do a physical stock-take** at `/admin/stock-takes` before trading. The first load puts no stock in.

## 5. Customer sign-in needs two public values at build time

Customers sign in through Supabase. The app needs the Supabase project URL and anon key **baked into the image when it is built** (they are public by design, not secrets). Without them, customer pages throw an error in production (`customer-session.ts`) and customers cannot register or sign in. Staff login at the till is separate and still works.

Two ways:

1. **Use the CI image.** The repository publishes `ghcr.io/heritage-of-faith/favo-webapp` on every push to `main`, but only once someone has set the repository variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (GitHub: Settings, Secrets and variables, Actions, Variables). Until then the publish step refuses to run. If the package is private, run `docker login ghcr.io` first. Prefer a commit-sha tag over `latest`: set `FAVO_IMAGE` in `.env`.
2. **Build it yourself.** Fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and optionally `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) in `.env`, then run `docker compose build app` and `docker compose up -d`. It takes a while and needs a few GB of memory. A VM with little memory may fail to build.

Also add your public address as a redirect for password reset in the Supabase dashboard (whoever holds that login). Push notifications need the VAPID keys (`npx web-push generate-vapid-keys`); without them push shows as "not configured".

## 6. Everyday running

- **Logs:** `docker compose logs -f app`. After boot you should see `[scheduler] started: checkLowStock`.
- **Status:** `docker compose ps`. The app shows `healthy` once ready.
- **Stop (keeps data):** `docker compose down`. **Never** add `-v`: that deletes the database volume.
- **Update:** change `FAVO_IMAGE` if you pin a tag, then `docker compose pull && docker compose up -d`. The new image migrates the database on start. **Take a backup first.**
- **Backup, nightly.** Add this to the machine's crontab (`crontab -e`), changing the folder and the backup folder. It keeps 14 days. Check that a file appears and is not empty, and **try a restore once** on another machine; a backup never restored is not a backup.

  ```
  15 1 * * * cd /path/to/deploy/free-host && docker compose exec -T db pg_dump -U favo -Fc favo > /path/to/backups/favo-$(date +\%F).dump && find /path/to/backups -name 'favo-*.dump' -mtime +14 -delete
  ```

  This is a cheap stand-in. It can lose up to a day and does **not** meet the PRD 9.4 target of 5 minutes. Copy the dumps off the machine too.

## 7. Updates and migrations marked "requires approval"

Some migrations carry `-- favo:requires-approval` in their first lines (they touch money tables or drop data). The migrator refuses to apply one unless `FAVO_APPROVE_MIGRATION` names its exact tag, for example `0043_at201_tender_payments`; several are separated by commas, and one approval never covers a later one. The rule: take a backup first and check it, set the variable in `.env` for that start only, run `docker compose up -d`, then **remove it** afterwards. If it refuses, read the `[migrate] FATAL` line, which names the tags. List what is marked now with `grep -l 'favo:requires-approval' drizzle/*.sql`. All pending migrations apply in one transaction, so a failure leaves the database as it was. Full rule: `docs/GO_LIVE_RUNBOOK.md` section 3. When PR #262 (AT-168) merges, also delete the `DATABASE_URL_SESSION` line from `docker-compose.yml`.

## 8. When it breaks

1. **Nothing loads.** `docker compose ps`. If `app` is restarting, read `docker compose logs app`.
2. **`[migrate] FATAL` asks for approval.** Section 7.
3. **Container refuses to start about `DATABASE_URL_SESSION`.** That variable is retired (PR #262). Make sure it is not set in `.env` or `docker-compose.yml`.
4. **Compose says a variable is missing.** Fill it in `.env`.
5. **Platform / "exec format" error.** Image and machine chip differ (Intel versus ARM). Build locally (section 5, way 2).
6. **The address stopped working.** Quick tunnels change on restart. Section 4, step 6.
7. **Customer sign-in errors.** The Supabase values were not baked in (section 5).
8. **Queue board stale.** Check the tunnel and the machine are awake; reload the tablet.
9. **Data looks lost.** Do not run `docker compose down -v`. Restore the latest dump: start only the database, then `docker compose exec -T db pg_restore -U favo -d favo --clean --if-exists < your.dump`.
10. **The machine is gone.** The café runs on paper and the Yoco machine, which is why this is only a stand-in.

## 9. Moving to Transformate later

When the real server exists (after OPEN-08): take a last dump (`pg_dump -Fc`), restore it into Transformate's Postgres, set that server's secrets in Infisical, start the same image there, and point DNS at it (`favo.hofmi.net` via Cloudflare for SaaS, PRD 9.3). Only DNS changes for users. Then delete this kit's volume and machine. Go-live steps stay in `docs/GO_LIVE_RUNBOOK.md`.
