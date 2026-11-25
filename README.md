# Rooted & Rising: Car Companion

A web app where customers keep their car details, service and tyre records, and reminders in one place, behind an email-and-password login. A separate admin portal lets the super admin see who has an account and who is online, read-only.

| | |
|---|---|
| **Live site (customers)** | https://rootedrising.pages.dev |
| **Admin portal** | https://rootedrising.pages.dev/admin |
| **Code** | GitHub: `GerhardVanWijk/Rooted-Rising`, branch `main` (public repository) |
| **Hosting** | Cloudflare Pages project `rootedrising` |
| **Database** | Cloudflare D1 database `rootedrising-db` |
| **On this laptop** | `~/Projects/Rooted-Rising` |

> The repository is public. No passwords, keys or secrets are stored in it; they live only in Cloudflare (see [Secrets](#secrets)).

---

## 1. What the app does

### Customers (main page `/`)
- **Log in** or **Create an account** with email and password only (no Google or social sign-in).
- After logging in there are four tabs:
  - **Home**: their car, the number of open reminders and the next three due.
  - **Garage**: car nickname, make/model/year, registration, tyre size, roadside assistance and emergency contact numbers.
  - **Records**: tyre purchases, services and repairs, with date, amount paid (R), workshop and notes.
  - **Reminders**: licence disc, service, tyre check and so on. Each can be marked done, or added to the phone's calendar as an `.ics` file with an alert 0, 7, 14 or 30 days before.
- Data is saved to their account in the database, so it appears on any device they log in from.
- **Password** button: change password; every other device is logged out.
- **Log out** button.
- If someone used the old browser-only version, their saved details are moved into their account the first time they log in.

### Super admin (`/admin`)
- Separate login page, for admins only. Customers are refused there, and admins are refused on the customer page.
- **Customers** table: email, status (Online now / Logged in / Logged out), last active, last login, joined date, and the number of devices logged in.
- Summary cards: number of customer accounts, number online now (active in the last 5 minutes), and failed logins in the last 24 hours.
- **Security log**: the last 100 events (sign-ups, logins, failed logins, lockouts, password changes) with time, email and IP address. Events are kept for 90 days.
- **Read-only by design.** The admin cannot edit, suspend, delete or log in as a customer, and cannot see customers' car data. No API exists that would allow it.
- **Password** and **Log out** buttons.

### How the super admin account exists
The admin account was created once through a one-time setup page protected by a setup code. That page, its code and the `SETUP_CODE` secret have since been **removed**. A new admin can now only be created by the owner from the command line (see [Admin tool](#admin-tool)).

---

## 2. How it is built

Everything runs on Cloudflare. There is no build step: the files in `dist/` are served exactly as they are.

```
Browser ──► Cloudflare Pages (rootedrising.pages.dev)
              ├─ static files from dist/            (pages, scripts, styles, image)
              │    └─ security headers from dist/_headers
              └─ Pages Functions from functions/    (the /api/... endpoints)
                   ├─ D1 database rootedrising-db   (accounts, sessions, data, logs)
                   ├─ Cloudflare Turnstile          (bot check)
                   └─ Have I Been Pwned range API   (breached-password check)
```

### Folder layout

```
Rooted-Rising/
├── README.md                  this file
├── wrangler.toml              Cloudflare config: project name, output folder, D1 binding "DB"
├── package.json               npm scripts and the Wrangler dev dependency
├── .dev.vars                  local-only test secrets (gitignored, never committed)
├── dist/                      everything the browser downloads
│   ├── index.html             customer page
│   ├── app.js                 customer app: login/sign-up, tabs, saving, calendar export
│   ├── admin.html             admin page
│   ├── admin.js               admin app: login, customers table, security log
│   ├── security.js            shared: Turnstile bot check and change-password window
│   ├── style.css              all styling (brand colours, mobile layout)
│   ├── cosmos.webp            hero background image
│   └── _headers               security headers Cloudflare adds to every page
├── functions/                 server code (Cloudflare Pages Functions)
│   ├── _shared/auth.js        security core: passwords, sessions, rate limits, Turnstile, log
│   └── api/
│       ├── _middleware.js     runs before every /api request: blocks cross-site writes, hardens headers, hides errors
│       ├── [[path]].js        any unknown /api address returns 404
│       ├── signup.js          POST /api/signup      create a customer account
│       ├── login.js           POST /api/login       log in (customer or admin portal)
│       ├── logout.js          POST /api/logout      log out (?portal=admin for admin)
│       ├── me.js              GET  /api/me          who is logged in (?portal=admin for admin)
│       ├── data.js            GET/PUT /api/data     load or save the customer's car data
│       ├── password.js        POST /api/password    change own password
│       └── admin/
│           ├── users.js       GET /api/admin/users  customer list and online status (admin only)
│           └── events.js      GET /api/admin/events security log (admin only)
├── migrations/                database structure, applied in order
│   ├── 0001_auth.sql          users, sessions, user_data
│   └── 0002_security.sql      attempts (rate limits), audit_log; old sessions retired
└── scripts/
    └── create-superuser.mjs   owner-only tool to create an admin or reset its password
```

### Database tables (D1: `rootedrising-db`)

| Table | Holds |
|---|---|
| `users` | id, email (unique, case-insensitive), password hash, role (`customer` or `superuser`), created date, last login |
| `sessions` | SHA-256 hash of each login token (never the token itself), user, created, last seen, expiry |
| `user_data` | one row per customer: their car, records and reminders as checked JSON |
| `attempts` | rate-limit counters (failed logins per IP and per email, sign-ups per IP, password-change failures); cleared after a day |
| `audit_log` | security events with time, email, IP and browser; cleared after 90 days |

---

## 3. Security

Every layer below runs on Cloudflare.

### Bots and automated attacks
- **Cloudflare Turnstile** is required on sign-up, customer login and admin login. It is invisible for normal visitors and only shows a checkbox if Cloudflare is unsure. The server verifies every token with Cloudflare and checks that it was issued for the right form.
- Turnstile refuses tokens to automated or remote-controlled browsers, so the live login can only be tested by a person.
- Cloudflare's own network-level DDoS protection applies automatically.

### Brute force and abuse

| Limit | Value |
|---|---|
| Wrong passwords for one email | 8 in 15 minutes, then that email is locked for 15 minutes |
| Failed logins from one IP address | 30 in 15 minutes |
| New accounts from one IP address | 10 per hour |
| Wrong current password when changing password | 5 in 15 minutes |

Only *failed* logins and *successful* sign-ups count per IP, so people sharing a mobile network or Wi-Fi don't block each other.

### Passwords
- At least 10 characters, at most 200; can't contain the email address; can't be one repeated character.
- **Breached-password check:** passwords found in public data breaches are refused. Only the first 5 characters of the password's SHA-1 hash are sent to Have I Been Pwned, never the password. If the service is down, sign-up still works.
- **Storage:** PBKDF2-SHA-256 with 100,000 iterations (the most Cloudflare Workers allows) and a random salt per password, **plus a secret pepper** stored only in Cloudflare. A stolen copy of the database alone is not enough to crack passwords.
- Older or unpeppered hashes are upgraded automatically at the next successful login.
- Response times are the same whether or not an email exists, so attackers can't probe for accounts.

### Sessions (being logged in)
- A random 256-bit token in a cookie; the database stores only its SHA-256 hash.
- Cookies are `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`: page scripts can't read them, they're sent only over HTTPS and only to this exact site, and other subdomains can't overwrite them.
- Customers and admins have **separate cookies** (`__Host-rr_session`, `__Host-rr_admin`), so both can be logged in in the same browser without interfering.

| | Ends after inactivity | Maximum length |
|---|---|---|
| Customer | 7 days | 30 days |
| Admin | 30 minutes | 12 hours |

- Changing a password logs out every other device.

### Requests and data
- **Cross-site request forgery:** every request that changes something must come from this site itself (`Origin` and `Sec-Fetch-Site` checks) and must be JSON, so another website can't act for a logged-in user.
- **Saved data is checked field by field** on the server: text lengths, allowed record and reminder types, real calendar dates, sensible amounts, at most 500 records and 500 reminders, and no duplicate IDs. Unknown fields are dropped. Everything shown on screen is escaped, so stored text can't run as code.
- Request bodies are capped at 600 KB.
- Server errors return a generic message; details go only to Cloudflare's logs.
- Admin endpoints check for an admin session **and** the `superuser` role.

### Browser security headers (`dist/_headers` and `_middleware.js`)
- **Content Security Policy:** the browser may only run scripts from this site and `challenges.cloudflare.com`, and only frame Turnstile. No inline scripts or styles. The site can't be embedded in other sites.
- **HSTS** (HTTPS always, 2 years, includes subdomains), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy`, and a `Permissions-Policy` that turns off camera, microphone, location, payment and USB.
- Cross-origin isolation headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`), and the default `Access-Control-Allow-Origin: *` is removed.
- `/admin` is marked `noindex` so search engines don't list it.
- API responses use `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'`.

> **When adding anything external** (a font, script, analytics or image from another site), add its address to the Content Security Policy in `dist/_headers`, or the browser will block it.

### Secrets

Stored encrypted in Cloudflare (Pages project → Settings → Variables and Secrets). They are not in the code or on this laptop.

| Secret | Purpose |
|---|---|
| `TURNSTILE_SECRET` | lets the server verify bot-check tokens with Cloudflare |
| `PASSWORD_PEPPER` | secret mixed into every password hash |

> ⚠️ **Never delete or change `PASSWORD_PEPPER`.** It isn't saved anywhere else. If it is lost or changed, every existing password stops working, and the admin would have to be reset with the admin tool while every customer creates a new account.

The Turnstile **site key** (`0x4AAAAAAGQUdqIVJdcruu6U`, widget "Rooted & Rising login", allowed on `rootedrising.pages.dev`) is public by design and lives in `dist/security.js`. On any other address, such as the local preview, Cloudflare's official test keys are used instead.

---

## 4. Working on the app

### Requirements
Node.js and npm. Wrangler (Cloudflare's tool) installs with `npm install`. Wrangler must be logged in (`npx wrangler login`) to the Cloudflare account that holds the `rootedrising` project. That login sees two accounts, so commands that touch Cloudflare need `CLOUDFLARE_ACCOUNT_ID` set to the account that owns the project.

### Run it on this laptop
```bash
cd ~/Projects/Rooted-Rising
npm install                # first time only
npm run db:migrate:local   # create or update the local test database
npm run dev                # http://localhost:8788
```
The local preview uses its own empty database (in `.wrangler/`) and the test keys in `.dev.vars`, so nothing you do locally touches real customers. If `.dev.vars` is missing, create it with:
```
PASSWORD_PEPPER=<any long random text>
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

### Change the database structure
Add a new numbered file in `migrations/` (for example `0003_something.sql`), test it locally with `npm run db:migrate:local`, then apply it to the live database with `npm run db:migrate` **before** deploying code that needs it.

### Deploy (publish to the live site)
1. Commit and push to `main` on GitHub.
2. Cloudflare Pages should build automatically from GitHub. **Currently pushes do not start a build**, probably because Cloudflare's GitHub app lacks access to the repo. Until that's fixed, start the build through the Cloudflare API: `POST /accounts/<account id>/pages/projects/rootedrising/deployments` with form field `branch=main`. This builds from GitHub's `main` just like an automatic build. Alternatively, use **Retry deployment / Create deployment** in the Cloudflare dashboard.
3. Don't use `wrangler pages deploy`, and don't create another Pages project. GitHub to Pages is the only deployment route.
4. Check the build: `npx wrangler pages deployment list --project-name rootedrising`.

### Admin tool
Creates the super admin, or resets its password if it's forgotten. Admins can't be created through the website.
```bash
SUPERUSER_PASSWORD='a-strong-password' node scripts/create-superuser.mjs admin@example.com --remote
```
Leave out `--remote` to do it on the local test database instead. This logs that admin out everywhere. The password is stored without the pepper (the pepper exists only in Cloudflare) and is upgraded automatically at the next login.

---

## 5. History

| Date | Change |
|---|---|
| 2026-11-23 | App imported (browser-only storage); Cloudflare Pages project `rootedrising` created and connected to GitHub |
| 2026-11-24 | Email/password accounts, D1 database, customer data saved per account, read-only super admin portal with one-time setup |
| 2026-11-24 | Customer and admin logins separated; main page always shows customer login and sign-up; fixed a blank main page |
| 2026-11-24 | Security hardening: Turnstile, strict headers, CSRF guard, rate limits, breached-password check, peppered hashes, `__Host-` cookies with idle timeouts, change password, security log; setup page removed; faster loading and tidier mobile header |
| 2026-11-24 | Unknown `/api` addresses return 404 |

---

## 6. Ideas for next steps
- **Two-step login for the admin** (code from an authenticator app): the biggest remaining security upgrade.
- **Cloudflare Access** in front of `/admin`, so only approved email addresses can even reach the page. Needs a one-time setup in the Cloudflare Zero Trust dashboard.
- **Forgot password** emails, which need an email-sending service.
- Restore **automatic deploys on push** by giving Cloudflare's GitHub app access to the repository.
- A **custom domain** (for example a rootedrising domain instead of `pages.dev`), which also unlocks Cloudflare WAF rules and rate-limiting rules at the edge.
