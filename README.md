# 4reels v3 🎬

Free, ad-free HD movie streaming with sidebar layout.

## Quick start

```bash
npm install
npm run hash yourpassword   # generates ADMIN_PASSWORD_HASH
# fill in .env (see .env.example)
npm start
```

## .env setup

```
PORT=3000
TMDB_API_KEY=        # from themoviedb.org
JWT_SECRET=          # any long random string
DISCORD_URL=         # https://discord.gg/...
DISCORD_WEBHOOK_URL= # optional, for DMCA/contact forms

# Neon Postgres — paste the "pooled" connection string from console.neon.tech
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require

# First admin (set before first boot, schema auto-created)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD_HASH=  # output of: npm run hash yourpassword
```

## Layout

- **Left sidebar** — persistent navigation, search, profile
- **Feature strip** — compact carousel banner (not full-bleed)
- **Movie rows** — horizontal scroll rows by category
- **Watch page** — player + info column + recommendations sidebar

## Player

Fixed height `min(52vh, 480px)` — never balloons. 11 servers: Strigil, VidUp, VidCore, FilmU, VidPlus, Vidsrc0, AdRock, VidNest, VidLink, Vidify, Vidzee.

## Database (Neon Postgres)

Schema auto-created on boot. `users` table fields:

| column | type | notes |
|---|---|---|
| id | SERIAL | primary key |
| username | TEXT UNIQUE | 3-20 chars, alphanumeric + _ |
| email | TEXT | optional |
| password_hash | TEXT | bcrypt 10 rounds |
| role | TEXT | member / moderator / admin |
| display_name | TEXT | shown in UI |
| bio | TEXT | profile bio |
| avatar_color | TEXT | CSS color string |
| avatar_base64 | TEXT | uploaded photo |
| badge | TEXT | custom badge e.g. "⭐ VIP" |
| banned | BOOLEAN | locked out of login |
| created_at | TIMESTAMPTZ | auto |

## Custom logo

Drop `4reels.png` into `public/` — served at `/logo.png` automatically.
