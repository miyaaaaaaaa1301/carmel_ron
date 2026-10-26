# Carmels in Communion

A React and Express prototype for the Philippine Federation of Discalced Carmelite Nuns. The client contains the public website and administration dashboard; the server provides API routes backed by PostgreSQL and Prisma.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL for database-backed API features

## Run locally

Install dependencies from the project root:

```powershell
npm install
npm --prefix client install
npm --prefix server install
```

Copy `server/.env.example` to `server/.env` and set the database URL and secrets for your environment. Then prepare the database and start the client and API:

```powershell
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

The website runs at http://localhost:5173 and the API runs at http://localhost:4000. The database commands require a running PostgreSQL instance configured in `server/.env`.

Discerner registrations, discernment conversations and replies, contact inquiries, and Admin-managed website content are stored by the API in PostgreSQL, not in the visitor's browser. Discerning users can message the Federation from their account; the public floating chat also creates a saved conversation, with a signed HttpOnly visitor cookie allowing the visitor to receive and reply to staff messages without signing in. Admins and Formators can read and reply from the dashboard inbox, which refreshes automatically. The dashboard Messages badge and notification bell refresh from the API; the badge counts unread incoming messages, and the notification list includes recent messages, account registrations, donations, dashboard audit activity, published updates, and managed website-content changes. Opening an unread message marks its incoming messages as read for the staff inbox. The homepage image, monastery details, Carmelife/Carmelights stories, and published Carmelinks updates use the `PageContent` table. Existing browser-managed monastery, story, and update data is copied to PostgreSQL the first time an Admin opens the relevant content section, if no database record exists yet. Content changes report an error if the API or database is unavailable; they are not treated as successfully saved to local storage alone.

Admin account management, including User and Formator counts, contact details, account status, Formator creation, and Formator permissions, is backed by PostgreSQL. Formator accounts use hashed passwords and share the same database-backed sign-in as other accounts. Some prototype dashboard features and member preferences remain browser-local and are not shared between browsers. For production, point `DATABASE_URL` at a managed PostgreSQL database with persistent storage and backups. Keep that database independent from the website host so removing or redeploying the website does not remove records. Database retention and backups depend on the database provider and its configuration.

To build both applications, run `npm run build`.

## Prototype access

The client includes a prototype Admin account for local dashboard previews. The example development environment configures this account to authenticate with the API. Some prototype dashboard data remains unsuitable for production security or persistence. Website content, user accounts, Formator accounts, and uploaded images are stored in PostgreSQL; URL-based images remain dependent on their external host. Discerner registration and contact inquiries also use the PostgreSQL-backed API described above.

Never commit `server/.env` or production secrets; only the `.env.example` template belongs in Git.
