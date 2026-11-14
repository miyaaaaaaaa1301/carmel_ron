# Carmels in Communion

A React and Express prototype for the Philippine Federation of Discalced Carmelite Nuns. The client contains the public website and administration dashboard; the server provides API routes backed by PostgreSQL and Prisma.

## Requirements

- Node.js 20 or newer
- npm
- Docker Desktop for the local PostgreSQL database

## Run locally

Start PostgreSQL in Docker from the project root:

```powershell
docker compose up -d postgres
```

Install dependencies from the project root:

```powershell
npm install
npm --prefix client install
npm --prefix server install
```

Copy `server/.env.example` to `server/.env`. Its database URL is configured for the local PostgreSQL container; replace the placeholder secrets before using anything beyond local development. Then prepare the database and start the client and API:

```powershell
Copy-Item .\server\.env.example .\server\.env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

The website runs at http://localhost:5173 and the API runs at http://localhost:4000. PostgreSQL runs in Docker and is available to the local app at `localhost:5433` (mapped to port 5432 inside the container); its data persists in the `postgres-data` Docker volume when the container is stopped. Stop the database with `docker compose down` (this keeps the data).

Member and staff sign-in pages include password recovery. To deliver reset links and donation acknowledgment emails, create a Resend API key, verify a sending domain in Resend, and set these values in `server/.env`:

```env
RESEND_API_KEY="re_your_resend_api_key"
RESEND_FROM="Carmels in Communion <receipts@example.org>"
```

`RESEND_FROM` must use an email address on the domain verified in Resend. Keep the API key private. Password reset tokens are stored hashed and expire after one hour.

Donors can request an email acknowledgment during checkout. The server sends it only after the donation is confirmed (`COMPLETED` for Xendit payments or `VERIFIED` after staff checks a manual payment claim). Pending or unverified donations do not receive a success email. The acknowledgment includes the donation reference, amount, fund, payment method, and date. To apply the receipt-delivery tracking fields on an existing database, run `npm run db:generate` and `npm run db:push` from the project root, then restart the API. Email delivery requires the SMTP settings above.

Discerner registrations, discernment conversations and replies, contact inquiries, and Admin-managed website content are stored by the API in PostgreSQL, not in the visitor's browser. Discerning users can message the Federation from their account; the public floating chat also creates a saved conversation, with a signed HttpOnly visitor cookie allowing the visitor to receive and reply to staff messages without signing in. Admins and Formators can read and reply from the dashboard inbox, which refreshes automatically. The dashboard Messages badge and notification bell refresh from the API; the badge counts unread incoming messages, and the notification list includes recent messages, account registrations, donations, dashboard audit activity, published updates, and managed website-content changes. Opening an unread message marks its incoming messages as read for the staff inbox. The homepage image, About Us images, monastery details, Carmelife/Carmelights stories, Contact Us page image and details, and published Carmelinks updates use the `PageContent` table. Admins and Formators with Manage Details permission can update the eight About Us pictures under **Manage Details → About Us** and the Contact Us page image plus the public phone number, email, Facebook link, and location under **Manage Details → Contact Us**. Existing browser-managed monastery, story, and update data is copied to PostgreSQL the first time an Admin opens the relevant content section, if no database record exists yet. Content changes report an error if the API or database is unavailable; they are not treated as successfully saved to local storage alone.

Admin account management, including User and Formator counts, contact details, account status, Formator creation, and Formator permissions, is backed by PostgreSQL. Formator accounts use hashed passwords and share the same database-backed sign-in as other accounts. Some prototype dashboard features and member preferences remain browser-local and are not shared between browsers. For production, point `DATABASE_URL` at a managed PostgreSQL database with persistent storage and backups. Keep that database independent from the website host so removing or redeploying the website does not remove records. Database retention and backups depend on the database provider and its configuration.

The Carmelights content-admin section includes 30-day teaching-view and current-member-bookmark analytics. Opening a published teaching records a view; repeated views from the same browser or consented member are deduplicated per UTC day. Member-linked activity is recorded only for active accounts with recorded privacy consent; anonymous views store no user ID. To add the `ContentInteraction` table to an existing database, run `npm run db:generate` followed by `npm run db:push`. These analytics are engagement reporting only; a LightFM recommendation model and personalized reading recommendations are not currently implemented.

Discernment progress can use optional, member-consented engagement tracking. Members can enable or turn it off from **Account → Discernment**; turning it off deletes recorded discernment activity but leaves the current stage unchanged. The site timer pauses when the browser tab is hidden and stops after 10 minutes without interaction. Carmelights teachings count as completed after the configured share of their estimated reading time (estimated from word count and reading speed). Prayer/reflection milestones are self-reported check-ins; their text is never collected. Community-contact milestones count messages a member sends to Federation staff. Admins configure cumulative requirements under **Admin → Discerners → Milestone settings**. In **Admin → Discerners → Progress & analytics**, admins can review each member’s milestone totals and progress against the next-stage requirements; activity totals are shown only for members who enabled tracking. Users can see each requirement and their current progress, and their stage advances automatically when every configured nonzero requirement is met. All-zero requirements leave that transition disabled; these measures indicate site engagement, not spiritual readiness. After updating an existing database, run `npm run db:generate` and `npm run db:push`.

Admins can manually record donations from **Donations → Record Donation** and review them under **Transactions**. Transactions combines public-form submissions with manual entries and labels each record by source. A manual entry can include donor details, payment method and reference, and an optional JPG, PNG, WebP, or PDF proof (up to 5 MB). After pulling schema changes, run `npm run db:push` to update the local database before using database-backed donations.

The public donation form can use Xendit-hosted test checkout. Set `XENDIT_SECRET_KEY` in `server/.env` to the **test-mode secret key** (the server also accepts `XENDIT_TEST_SECRET_KEY`), and set `XENDIT_CALLBACK_TOKEN` to the callback token configured in Xendit's Dashboard. In **Settings → Developers → Webhooks**, configure the invoice webhook to `https://<your-public-https-host>/api/donations/xendit-webhook`; a local app needs an HTTPS tunnel so Xendit can reach the callback. Apply the new database columns with `npm run db:generate` and `npm run db:push`, then restart the API. Checkout is enabled only when both server settings exist. Each payment channel must also be activated for the Xendit account: open **Payment Channels → Activate Payment Channels** in the Dashboard and request activation for channels such as Bank Transfer. An API key with Write permission does not by itself activate a payment channel; some channels require account verification. Xendit redirects the donor back to the donation page, but the donation is marked paid only after the server validates Xendit's callback token and invoice amount. Test payments do not move real funds; verify the test-mode dashboard and selected payment channels before live use.

The **Audit Logs** section is available to Admins and Formators. It lists staff sign-ins/sign-outs and recorded administrative changes with the actor and timestamp. Public donation submissions and donation status changes are also recorded, but donation audit entries and donation notifications are visible to Admins only. Activity is stored in PostgreSQL. Public donation-form submissions do not require proof files; proof upload is only an optional field when staff record a donation manually.

Admins can use **System Backup** to export or merge application database records, including content, accounts, donations and their proof files, messages, reading interactions, and audit history. Exports are downloaded as AES-256-encrypted ZIP archives. Enter a unique password of at least 16 characters for each export and keep it securely; the application does not save it. Use the same password when importing the archive or opening it with a ZIP application that supports AES encryption (for example, 7-Zip). Successful exports and imports are recorded in the Admin audit log with timestamps. Imports add missing records and update matching IDs without deleting existing data; rows that conflict with an existing unique value and their dependent rows are skipped and reported. Exports are limited to 45 MB of unencrypted data. Earlier `.carmelbackup` exports remain importable when their original password is provided.

## Carmelights LightFM recommendations

The optional Python service in `recommender/` trains a hybrid LightFM/WARP model using consented member teaching views and current bookmarks. It uses existing teaching titles, author names, and body text as item metadata features; Carmelights entries also have a category field for filtering on the public page. Anonymous views remain available for popularity analytics and are never sent to LightFM training. Until the service has sufficient member interaction data, signed-in members receive a clearly labeled popularity fallback.

On Windows, install and start Docker Desktop first. Apply the `ContentInteraction` Prisma schema update using `npm run db:generate` and `npm run db:push`, then create a random internal API token in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Copy-Item .\recommender\.env.example .\recommender\.env
```

Set the generated token as `RECOMMENDER_API_TOKEN` in `recommender/.env` and as `LIGHTFM_API_TOKEN` in `server/.env`. Set `LIGHTFM_SERVICE_URL=http://127.0.0.1:8001` in `server/.env`. Keep both `.env` files private; do not commit them. Build and start the model service from the project root:

```powershell
docker compose -f .\recommender\compose.yaml run --build --rm lightfm python -m unittest test_main
docker compose -f .\recommender\compose.yaml up --build -d
npm run dev
```

The API is exposed only on local loopback port 8001 and the model artifact persists in the `lightfm-models` Docker volume. After signing in as an Admin, open **Manage Details → Carmelight** and choose **Train model**. Training requires at least two members, three published teachings, and six member-reading pairs; until then the model stays untrained and the site continues to use popularity fallback. The training result includes a timestamp-based offline ranking evaluation against a popularity baseline when there is enough test data; otherwise it explicitly reports that evaluation is unavailable. Latent components, epochs, view weight, and bookmark weight can be configured through `LATENT_COMPONENTS`, `TRAINING_EPOCHS`, `VIEW_WEIGHT`, and `BOOKMARK_WEIGHT` in the recommender environment.

Signed-in members can find **Recommended for You** in their account navigation. Recommendations show reading cards and never expose other members' identities, histories, model scores, or private account data. Docker's Linux container avoids compiling LightFM directly on Windows. For production, deploy the API and recommender on a private network, set a unique shared secret, retain the model volume, use HTTPS at the public edge, and use a managed persistent database. Retrain periodically from the protected Admin action as interaction data grows; do not rely on demo accounts or fabricated interactions to evaluate the model.

To build both applications, run `npm run build`.

Password-reset emails and Xendit checkout return links use the public website origin. On Railway, the server uses `PUBLIC_APP_URL` when set, otherwise it builds the HTTPS origin from `RAILWAY_PUBLIC_DOMAIN`; it falls back to `https://carmmessage-production.up.railway.app` for other production deployments. Production URLs must use HTTPS and cannot point to localhost. Local development uses `CLIENT_ORIGIN` or defaults to `http://localhost:5173`.

## Database-free visual demo

To preview the public site and the sign-in flows without PostgreSQL or the API, start only the Vite client with `npm --prefix client run dev`. The sign-in pages offer these browser-local demo accounts:

| Account | Email | Password |
| --- | --- | --- |
| Administrator | `demo.admin@carmel.test` | `DemoAdmin2026!` |
| Staff | `demo.formator@carmel.test` | `DemoFormator2026!` |
| Member | `demo.member@carmel.test` | `DemoMember2026!` |

These are public, simulated credentials for local visual previews only. They are not authenticated by the server and do not provide access to database-backed features. The Admin and Formator credentials open their role-specific dashboard previews; the Member credential opens the browser-local account panels. Admins and Formators can use **Manage Details** and **Updates** to edit website content without PostgreSQL. Demo changes to managed website pages, homepage images, thumbnails, and Updates are saved only in the current browser's local storage; they do not modify project source files, sync to other browsers, or publish to a database-backed site. Profile and other member-only preview data remains browser-local. Some tools that require server data will be empty or unavailable. Never use these accounts for a deployed site or real information.

Start the local browser preview with:

```powershell
npm --prefix client run dev -- --host 127.0.0.1
```

Local demo content is stored in this browser only. To share real website content between users, sign in to a database-backed installation; PostgreSQL remains authoritative for production content.

## Contributor and Copilot handoff

The database-free demo is only a way to inspect the Admin, Formator, and Member interfaces without connecting to PostgreSQL. It is not the production implementation. When making requested design or functionality changes for this project, update the application source so the changes are part of the project pushed to GitHub; do not implement the requested feature only in the demo account or browser-local preview. Keep production accounts, managed content, and other shared data connected to their existing API and PostgreSQL flows. Update this README when a change affects behavior, setup, permissions, or database migrations, and record notable user-requested code changes here so future maintainers and Copilot sessions have context.

### Recent code changes

- **2026-11-14 — Staff display name:** The website now displays the role previously labeled “Formator” as “Staff.” This is a display-only wording change; internal code, database role values (`FORMATOR`), API routes, and existing account credentials remain unchanged.
- **2026-11-14 — About Us image editing:** Admins and Formators with Manage Details permission can replace or upload the eight images used on the About Us page from Manage Details → About Us. Database-backed changes are shared across visitors; database-free demo changes remain in the current browser.
- **2026-11-14 — Contact Us image editing:** Manage Details → Contact Us includes the Contact Us page hero image as well as the public contact information; changes are saved with the shared website content.
- **2026-11-13 — Database-free role previews and content editing:** Demo Admin and Formator sign-ins open their respective dashboard layouts, and the demo Member opens the account panels. Without PostgreSQL, edits to managed website pages, homepage images, thumbnails, and Updates are saved only in the current browser's local storage; they do not change project source files or production database records. Demo profile data and features requiring server data remain local or unavailable.
- **2026-11-13 — Update category choices:** Removed **Community life**, **Meeting**, and **Official Letters** from the Admin create/edit category selectors and the public Updates category filters. Existing posts are not deleted or recategorized; they remain visible under **All Updates**.
- **2026-11-13 — Carmelights teaching display:** Removed the fixed reflection callout from the teaching reader. Public teaching cards and full readings show the title, author, and text maintained in Manage Details → Carmelights.
- **2026-11-13 — Carmelights category and saint selectors:** The Admin Carmelights editor allows typing categories and saint names or choosing from suggestions for existing values and common Carmelite saints. The public page has adjacent, unlabeled category and saint dropdowns that can be used together to filter teachings; saved custom categories and saints are included.

## Prototype access

Create a database-backed administrator by setting `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 16 characters in `server/.env`, then run `npm run db:seed`. Do not use shared or default credentials. Sign in at `/staff/login`; user and discerner accounts cannot access staff dashboards. Website content, user accounts, Formator accounts, and uploaded images are stored in PostgreSQL; URL-based images remain dependent on their external host. Discerner registration and contact inquiries also use the PostgreSQL-backed API described above.

Never commit `server/.env` or production secrets; only the `.env.example` template belongs in Git.
