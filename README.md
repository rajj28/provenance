# Provenance

**Your portfolio, updated by the work you already did.**

You ship things. Then your portfolio sits there, quietly lying about being current, until three days before an interview when you frantically add four projects and misremember what half of them did.

Provenance watches the places your work actually lands — GitHub, npm, PyPI, Dev.to, arXiv, ORCID, GitLab, Kaggle — figures out which bits belong on a portfolio, writes them up honestly, and puts them on your site. Your site. The one you already built, with your design, that you're weirdly attached to.

You come back to change how it looks. Not what's on it.

---

## The part where we tell you what it won't do

Most tools in this space open with a feature list. Here's the anti-feature list instead, because it's more useful and it's the actual product philosophy:

**It will not make things up.** No invented download counts, no "increased engagement by 40%", no inferred job titles. If a number isn't in an API response or typed by you, it doesn't appear. The curator marks fields it's unsure about, and uncertain items never auto-publish.

**It will not scrape.** Every connector uses a documented public API. When a platform closes theirs, the connector dies and we say so in the UI. There's a test that fails the build if a source is listed as working but has no adapter behind it — because that exact rot already happened once, and we'd rather CI catch it than a user.

**It will not rewrite your app.** It appends rows to your content. It does not touch your components, routes, styles, or build config. More on why below, because this is the part everyone gets wrong.

**It will not post anything without you clicking.** Unless you explicitly turn on Autopilot. Which has a brake. Which is on by default.

---

## Quickstart

```bash
git clone <your-fork> && cd portfolio-autopilot
docker compose up -d              # postgres + redis
cp .env.example .env              # windows: copy .env.example .env
npm install
npx prisma migrate deploy
npm run dev:all                   # web + worker
```

Now generate three secrets, because the placeholders in `.env.example` are not secrets, they're a dare:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Paste into `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`. In production the app refuses to boot if you leave them as-is. You're welcome.

Open <http://localhost:3000>, make an account, connect GitHub with a personal access token (`read:user` is enough), and wait. Or click **Sync now**, because waiting is for people with patience.

**Requirements:** Node 20+, Docker. No AI key needed — there's a heuristic curator that works offline and is genuinely decent.

---

## How it actually works

```
your commits  ┐
your packages ┤
your articles ┼──> discover ──> curate ──> [ you approve ] ──┬──> your website
your papers   ┘     (API)       (score)     or Autopilot     ├──> /p/your-name
                                                             └──> LinkedIn (optional)
```

1. **Discover** — adapters poll official APIs; a GitHub webhook makes pushes near-instant
2. **Curate** — scores significance, confidence, and relevance to your target role; flags what it can't verify
3. **Review** — you approve or reject. Or don't, if Autopilot is on
4. **Deliver** — approved items land on your site, and optionally get shared to LinkedIn

Everything after step 1 runs in a background worker, so nothing blocks on a slow API.

---

## Getting it onto *your* website

Three ways. Pick whichever makes you least uncomfortable.

### 1. Grab the JSON

```
GET /api/portfolio/your-slug
```

CORS-open, ETag-cached, no auth. Do whatever you want with it. This is just data.

### 2. Paste one line

```html
<div id="provenance"></div>
<script src="https://your-app/embed.js" data-slug="your-slug"></script>
```

Ships **zero CSS**. It renders semantic markup with stable `pv-` classes and then gets out of the way, so your stylesheet is in charge. Works on React, Astro, WordPress, Squarespace, a single `index.html` you wrote in 2019 — anything that runs a script tag.

| Attribute | What it does |
|---|---|
| `data-target` | Where to render (default `#provenance`) |
| `data-styles="basic"` | Fine, here's some starter CSS |
| `data-sections="projects,writing"` | Only these, in this order |
| `data-limit="3"` | Cap items per section |
| `data-headings="false"` | No section headings |

Use several script tags with different targets to scatter sections around a page. If the fetch fails, it leaves your existing content alone — an outage will never blank part of your site.

### 3. Let it commit to your repo

For static sites. Two strategies:

**Own a file** — we manage `data/portfolio.json`, you wire it into a template once. We detect your framework and pick the path it actually reads (`_data/` for Jekyll, `data/` for Hugo, `src/data/` for Astro and Next, and so on), so you don't have to remember.

**Append to what you already have** — no wiring at all. We read the content file your site *already* renders, adopt *its* field names, and add rows.

```jsonc
// src/data/projects.json — before
[{ "name": "Weather Dashboard", "blurb": "...", "tech": "React", "year": 2024 }]

// after
[{ "name": "Weather Dashboard", "blurb": "...", "tech": "React", "year": 2024 },
 { "name": "provenance-cli",    "blurb": "...", "tech": "TypeScript, Rust", "year": 2026 }]
```

Look closely: `tech` stayed a **string** and `year` stayed a **number**, because that's how *your* file stores them. We match your types instead of imposing ours. Your templates keep working.

---

## "But my projects are hardcoded in a .tsx file"

Yeah. Ours too. It handles that.

```tsx
// src/Projects.tsx — before
import heroImg from "./hero.png";
import { Star } from "lucide-react";

export const items = [
  { title: "First", url: "https://first.example", img: heroImg, icon: <Star />, tags: ["Go"] },
];

export default function Projects() { /* ...your JSX... */ }
```

It adds one element to `items`. Your imports, comments, JSX, and formatting come out byte-identical. `img` and `icon` are reported as *not statically readable, so never written* — it won't invent an image path for you.

This is the scary feature, so here's exactly why it isn't:

1. **Real parser.** TypeScript compiler API. Zero regex. Regex-editing someone's source is how you end up in an incident channel.
2. **One text insertion, one offset.** Everything else is copied byte-for-byte *by construction*. We never re-print through the TS emitter, because that reformats your whole file and you'd rightly never forgive us.
3. **Re-parsed afterward.** The result is rejected unless it's syntactically clean, targets the same array, has exactly N more elements, and every pre-existing element is textually unchanged.
4. **Cowardly by design.** Spreads, computed keys, methods, arrays built by function calls, arrays nested inside a component, or two candidate arrays in one file — it refuses and tells you why. It does not get creative.

A title containing a double quote won't break out of the string literal and turn the rest of your file into code. There's a test named after that exact nightmare.

**What it can't check is your build** — types, lint, your own invariants. Which is why **pull requests are the default**. Your CI runs before anything reaches production. Direct-commit exists, it's just opt-in and you're choosing that.

**The line it won't cross:** it reads a module-level array of object literals. It never reads or rewrites your application *logic*. Owning a content layer works across arbitrary frameworks. Rewriting components does not, and anyone promising otherwise hasn't thought about who gets paged.

---

## Autopilot

Set it in Settings. Three positions:

| | Mode | What happens |
|---|---|---|
| 🟢 | **Auto-publish** | Good stuff publishes itself and reaches your site |
| 🟡 | **Review first** | *(default)* Nothing ships without you |
| 🔴 | **Draft only** | Keep curating, touch nothing live |

Auto-publish is deliberately fussy. An item only goes out if **all** of:

- the curator actually recommended it
- significance >= your threshold (default 70)
- confidence >= your threshold (default 70)
- **nothing about it is flagged uncertain**

That last one is the whole ballgame. Uncertain claims are exactly the ones that shouldn't appear on a real person's portfolio while they're asleep.

Real numbers, from a live sync of 30 Dev.to articles at default thresholds: **7 published themselves, 23 waited for a human.** It's a filter, not a rubber stamp.

An unrecognised value in the database reads as `review`. Failing safe is the only acceptable direction to fail.

---

## Sources

**Working, via official APIs:**

| Source | You provide | Notes |
|---|---|---|
| GitHub | OAuth or a PAT | Repos, releases, READMEs, languages, merged PRs. Private repos are never requested |
| GitLab | PAT (`read_api`) | Owned public projects on gitlab.com |
| npm | Username | Packages the registry attributes to you |
| PyPI | Project names | See below |
| Dev.to | Username | Public articles, no key needed |
| arXiv | Author name | Name collisions get flagged uncertain, because "J. Smith" is not an identifier |
| ORCID | Your iD | Public works |
| Kaggle | Username + API key | Kernels you authored |

**PyPI needs explaining.** There is no documented endpoint that lists a username's projects — the profile page is HTML only. So you name your projects and we read the official project JSON API. We also never claim you own them, because the API doesn't say that.

### The graveyard

Platforms that took their APIs away, kept here as an honest record rather than quietly dropped:

- **Hashnode** — killed free GraphQL access on 2026-05-13; reading now needs a paid Pro plan. The unauthenticated endpoint redirects to their announcement, which is a bold way to break every integration you had
- **LinkedIn** — see below, it's a whole thing
- **Devpost** — no public user API, never had one
- **Notion / Google Drive / YouTube** — real APIs exist, deliberately deferred

For all of these: import the item manually. It gets curated and filed exactly like discovered evidence. We'd rather have an honest manual path than a connector that lies about working.

---

## LinkedIn: a one-way street

LinkedIn will let this app **write to your feed** but **not read it**. We can post your new project. We cannot see the post you made yesterday.

| | Supported? | Because |
|---|---|---|
| Publish a portfolio item as a post | **Yes** | *Share on LinkedIn* is self-serve, grants `w_member_social` |
| Read your own posts | **No** | Needs `r_member_social` — "restricted, approved partners only" |
| Read your headline, roles, education, skills | **No** | Sign In with LinkedIn returns your name, picture, locale, email. That's the lot |

So LinkedIn is a **destination**, not a source. Which turns out fine, because we already know about your new project — we saw the commit. Your LinkedIn history goes in via manual import.

If some tool claims it auto-imports your LinkedIn profile, it's scraping, and that's against their ToS and your interests.

**Setup:** create an app at [linkedin.com/developers](https://www.linkedin.com/developers/apps), add both *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn*, set the redirect to `$APP_URL/api/integrations/linkedin/callback`, fill in `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

Nothing posts automatically. You get a draft composed from the item's own facts, you edit it, you press the button. Tokens last about 60 days (refresh tokens are partner-only, sorry), then it asks you to reconnect.

---

## Configuration

Everything lives in `.env`; see `.env.example` for the full list.

| Variable | Required | |
|---|---|---|
| `DATABASE_URL` | yes | Postgres |
| `REDIS_URL` | yes | Queue |
| `APP_URL` | yes | Absolute, used in OAuth callbacks and OG tags |
| `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `CRON_SECRET` | yes | 32+ chars each in production, and not the placeholder |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables "Connect with GitHub"; a PAT works without it |
| `LINKEDIN_CLIENT_ID` / `_SECRET` | no | Publishing only |
| `OPENAI_API_KEY` | no | Without it, the heuristic curator runs. It's fine |

`src/lib/env.ts` validates all of it at import. A misconfigured deploy dies at startup with a readable message instead of at 3am with a stack trace.

**`APP_ENCRYPTION_KEY` cannot be rotated** without re-encrypting stored credentials. Rotating it invalidates every connected source and LinkedIn token. Pick it once.

---

## Deploying

```bash
cp .env.example .env.production   # fill in real values
npm run docker:prod
```

Brings up web + worker + migrations + postgres + redis. Migrations run to completion before anything serves traffic. Unlike the dev compose file, no database port is exposed to the host. Put a TLS proxy in front of `web`.

Then point a scheduler at `GET /api/cron/sync` with `Authorization: Bearer $CRON_SECRET` every few minutes.

**What's hardened:** CSP, HSTS and the usual headers, `X-Powered-By` gone, no-store on authenticated routes. AES-256-GCM for stored credentials. Constant-time cron secret comparison. Signed, 10-minute OAuth state. Sign-in throttled inside the `authorize` callback — the chokepoint a direct POST to the credentials endpoint also has to pass through, which is the mistake worth not making. `/api/health` reports Postgres as fatal and Redis as degraded-but-serving, because sync falls back to inline. Worker drains in-flight jobs on SIGTERM.

---

## Development

```bash
npm run dev:all     # web + worker
npm test            # 151 tests
npm run verify      # typecheck + lint + test
```

The test suite is hermetic — it supplies its own environment and doesn't care about your `.env`.

Worth reading if you're poking around:

- `src/lib/site/append.ts` — the append-only proof for JSON
- `src/lib/site/ts-append.ts` — the TypeScript-parser appender
- `src/lib/portfolio/autopilot.ts` — what's allowed to publish unattended
- `src/lib/sources/catalog.ts` — every connector, and honest notes on each

If you add a source: official APIs only. A connector that scrapes, or that lies about working, doesn't get merged. `catalog.test.ts` will fail the build anyway, so you'd only be wasting your own time.

---

## Licence

[AGPL-3.0](./LICENSE) — Copyright (C) 2026 Ruturaj Sonkamble. Self-host it, fork it, change it, run it for your friends — go ahead. If you run a modified version as a network service, share your changes.

Open source is a deliberate choice here rather than a marketing one: this app asks for a GitHub token with write access and permission to post as you. You should be able to read exactly what it does with them. Start at `src/lib/site/`.

---

<sub>Named for the archival sense of <em>provenance</em> — the documented chain of custody that makes a claim believable. Which is roughly the whole point.</sub>
