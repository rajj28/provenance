# Provenance

A professional portfolio that updates itself from evidence.

Connect GitHub and other official APIs. The worker discovers activity, scores whether it belongs on a portfolio, and waits for your approval before anything is published.

> Connect the places where your work happens. AI discovers what matters, turns evidence into professional stories, and keeps your portfolio continuously up to date.

## Architecture

Built to stay fast as user count grows, without a microservice forest:

| Layer | Choice | Why |
| --- | --- | --- |
| Web | Next.js App Router | UI + thin APIs, horizontally scalable, CDN-friendly public pages |
| Data | PostgreSQL 16 | Durable source of truth; JSON evidence + indexed review queues |
| Jobs | Redis + BullMQ workers | Sync and curation off the request path; add worker replicas independently |
| Auth | Auth.js (JWT) | Stateless sessions; credentials locally, GitHub OAuth for source connect |
| Tokens | AES-256-GCM at rest | Least-privilege GitHub scopes; never sent to the browser |

```
Browser → Next.js (web) → PostgreSQL
                 ↓ enqueue
               Redis → worker replicas → GitHub / registries / optional OpenAI
GitHub webhook / cron → Next.js → same queue
```

If Redis is unavailable locally, sync still runs inline so development does not hard-fail.

## Requirements

- Node.js 20+
- Docker Desktop (Postgres + Redis)

## Local setup

```bash
docker compose up -d
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux
```

Set `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, and `CRON_SECRET` in `.env` to long random strings before any real use.

```bash
npm install
npx prisma migrate deploy   # applies prisma/migrations
npm run dev:all
```

Generate real secrets before any real use:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Open [http://localhost:3000](http://localhost:3000).

- `npm run dev` — web only (inline sync if Redis is down)
- `npm run worker` — background sync/curation
- `npm test` — heuristic and fingerprint tests

### Flow

1. Create an account
2. Connect GitHub (OAuth or a PAT)
3. Wait for sync (or click **Sync now**)
4. Review recommendations — approve / reject
5. Edit copy on **Portfolio**
6. Share `/p/{your-slug}`

## GitHub

**First-class.** Official REST + Search APIs via Octokit.

| Mode | What you need |
| --- | --- |
| Personal access token | `read:user` is enough for public profile/repos of the authenticated user. Fine-grained: Account read + public repository metadata/contents. |
| OAuth App | Create at GitHub → Settings → Developer settings → OAuth Apps. Homepage `http://localhost:3000`. Callback `http://localhost:3000/api/integrations/github/callback`. Scopes requested: `read:user user:email`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. |
| Webhooks (optional) | Point a repo or org webhook at `POST /api/webhooks/github`. Set `GITHUB_WEBHOOK_SECRET`. Events such as `push` and `release` enqueue a sync. |
| Polling | `GET /api/cron/sync` with `Authorization: Bearer $CRON_SECRET` enqueues stale connections (15 minutes). |

Private repositories are not requested in the MVP.

## Other live sources (official APIs only)

| Source | Auth | Notes |
| --- | --- | --- |
| GitLab | PAT `read_api` | gitlab.com owned public projects |
| npm | Username | Registry search `maintainer:` |
| PyPI | Project names | Official `/pypi/<project>/json`. PyPI has no documented endpoint listing a username's projects, so projects are named explicitly rather than scraped, and ownership is never claimed. |
| Dev.to | Username | Forem public articles API |
| arXiv | Author name | Atom API; name collisions marked uncertain |
| ORCID | Public iD | Public works API v3 |
| Kaggle | Username + API key | Official kernels list. Competition rank is not assumed. |

## Autopilot

How much runs without you. Set it in **Settings**.

| Mode | Behaviour |
| --- | --- |
| 🟢 **Auto-publish** | Discoveries that clear the bar publish themselves and reach your website. Everything else still queues for review. |
| 🟡 **Review first** | *(default)* Everything is discovered, curated and scored; nothing goes live until you approve it. |
| 🔴 **Draft only** | Keep discovering and curating, but never change your live website. Delivery is paused. |

Auto-publish is deliberately strict. An item publishes itself only if **all** of these hold:

- the curator actively recommended it (`add`, not `skip`)
- significance ≥ your threshold (default 70)
- confidence ≥ your threshold (default 70)
- **no field is flagged uncertain**

That last condition is the important one. Uncertain fields are precisely the claims that should never appear on someone's portfolio unattended, so any item carrying one waits for a human regardless of its score.

Measured against a live sync of 30 dev.to articles at the default thresholds: 7 published themselves, 23 were held for review. An auto-published item is created by the same code path as a hand-approved one, so it is identical, editable, and reversible.

An unrecognised value in the database reads as `review`, never as permission to publish.

## Onboarding shape

The complexity is meant to stay behind the product, not in front of the user:

```
Connect sources  →  Connect your website  →  Choose autopilot  →  Done
   (OAuth/handle)      (repo or snippet)        (three modes)
```

When a repository is connected, the app inspects it and picks the data path that framework actually reads — `data/portfolio.json` for Hugo, `_data/portfolio.json` for Jekyll, `src/data/portfolio.json` for Astro/Next/SvelteKit, and so on — so the member never has to know. Detection is best-effort; an unrecognised repo falls back to a sensible default they can change.

Note what this deliberately does **not** do: it never reads, rewrites, or reasons about the member's components, routes, or styles. It owns one content file and nothing else. That constraint is what makes the integration work across arbitrary frameworks and what keeps it safe to run unattended.

## Your own website

Keep your existing site, framework, and design. Two delivery routes, usable together.

### A. Embed or fetch the JSON feed

Every public portfolio is served as JSON:

```
GET /api/portfolio/{slug}
```

CORS-open, ETag-revalidated, and cached with a long stale window. Consume it directly, or drop in the bundled renderer:

```html
<div id="provenance"></div>
<script src="https://YOUR-APP/embed.js" data-slug="your-slug"></script>
```

`embed.js` ships **no styling by default**. It emits semantic markup with stable `pv-` class names and lets the host page's CSS do everything, so it inherits any design. Options:

| Attribute | Effect |
| --- | --- |
| `data-target` | CSS selector to render into (default `#provenance`) |
| `data-styles="basic"` | Inject a minimal starter stylesheet instead of none |
| `data-sections="projects,writing"` | Render only these sections, in this order |
| `data-limit="3"` | Cap items per section |
| `data-headings="false"` | Omit section headings |

Use several script tags with different `data-target`s to place sections in different parts of a page. The renderer builds every node with `createElement`/`textContent` — nothing from the API is ever interpolated as HTML — and on a failed fetch it leaves the container's existing content untouched, so an outage never blanks part of your site. It also fires a `provenance:loaded` event for layout code that needs to re-run.

### B. Write into your site's repository

Two strategies, chosen when you connect.

**Own a data file** — we manage one `portfolio.json`; you wire it into a template once. (JSON only: this strategy overwrites the whole file, so it can never be pointed at a source module.)

**Append to the file your site already uses** — no wiring at all. We read the content file your site already renders, adopt *its* field names, and add rows.

```jsonc
// your src/data/projects.json, before
[
  { "name": "Weather Dashboard", "blurb": "…", "link": "…", "tech": "React", "year": 2024 }
]

// after — your field names, your types, your formatting
[
  { "name": "Weather Dashboard", "blurb": "…", "link": "…", "tech": "React", "year": 2024 },
  { "name": "provenance-cli", "blurb": "…", "link": "…", "tech": "TypeScript, Rust", "year": 2026 }
]
```

Note what happened there: `tech` stayed a **string** because that file stores it as one, and `year` stayed a **number**. We match the column types already in the file rather than imposing ours, so existing template code keeps working.

#### The rules append mode operates under

- **Append-only, and proven.** Every write is verified before it is sent: the same number of pre-existing entries, byte-identical, in the same order, with exactly N new rows at the end. A violation raises and nothing is written.
- **Your field names, never ours.** Keys are inferred from the rows already in the file.
- **No invented values.** A key we cannot fill (`coverImage`, `featured`) is omitted rather than given a placeholder — an empty string in an image field renders a broken image.
- **Nothing outside the array changes.** Sibling keys in a wrapped document are checked too.
- **Idempotent.** New items are chosen by reading the live file and matching on URL then title, so a re-run adds nothing and hand-edits are respected.
- **Refuses rather than guesses.** Unparseable JSON, two candidate arrays, or no title-like field → we decline and say why.

#### Source modules (.ts / .tsx / .js / .jsx)

Plenty of portfolios keep their content in a module rather than a JSON file, so those are supported too — with a real TypeScript parser, never a regular expression.

```tsx
// src/Projects.tsx — before
import heroImg from "./hero.png";
import { Star } from "lucide-react";

export const items = [
  { title: "First", url: "https://first.example", img: heroImg, icon: <Star />, tags: ["Go"] },
];

export default function Projects() { /* …your JSX, untouched… */ }
```

We add one element to `items`. Your imports, comments, JSX and formatting are byte-identical afterwards, and `img`/`icon` are reported as **not statically readable, so never written** — we don't fabricate an image path.

Four things make this safe:

1. **A real parser.** The TypeScript compiler API reads the module; nothing is matched with regex.
2. **The mutation is a single text insertion at one offset.** The rest of the file is copied byte-for-byte *by construction*. We never re-print through the TS emitter, which would reformat everything.
3. **Post-parse validation.** The result is re-parsed and rejected unless it is syntactically clean, targets the same array, has exactly N more elements, every pre-existing element's source text is unchanged, and nothing before or after the insertion point moved.
4. **A conservative reader.** Spreads, computed keys, methods, function-built arrays, arrays nested inside a component, or two candidate arrays in one file are all **refused**, not guessed at.

String values are escaped for the file's own quote style, so a title containing a quote cannot terminate the literal and turn the rest of the file into code — there is a test for exactly that.

**What this still cannot verify is your full build** — types, lint, and your own invariants. That is precisely why **pull-request mode is the default**: your CI runs before anything reaches your live site. Use direct-commit mode only if you are comfortable without that gate.

Only these directories are scanned: `data/`, `src/data/`, `_data/`, `src/_data/`, `content/`, `src/content/`, `app/data/`, `public/data/`, `src/`, `src/config/`, `src/constants/`, `config/`, `lib/`, `src/lib/`. Tests, `*.d.ts`, framework config files, and `package.json` and friends are excluded.

#### The line that stays

We read a module-level array of object literals. We do not read, rewrite, or reason about your application *logic* — components, routes, styles, and build config are never touched. Owning a content layer is safe across arbitrary frameworks; rewriting components is not.

Use **Scan repository** on the Sources page to see which files qualify, how many entries each has, and exactly which fields would be written.

#### Setup

1. **Sources → Your own website → Commit to your site's repo**
2. Repository (`owner/repo` or a GitHub URL) and branch
3. Choose a strategy: own a data file, or append to an existing one
4. Choose **pull request** (default; you review before your site changes) or **direct commit**
5. Paste a **fine-grained** token scoped to that one repository, with **Contents: Read and write** (plus **Pull requests: Read and write** for PR mode)

Access is verified when you connect, not on the first background write. The token is stored encrypted and is deliberately separate from your GitHub *source* connection — reading your public activity and writing to a repository are different grants, and the read connection is never silently upgraded.

Writes are hash-compared against the last payload, so an unchanged portfolio produces no commit. The file path must be a `.json` path inside the repo; traversal and non-JSON targets are rejected. Only that one file is ever touched.

### What triggers an update

```
push to GitHub ─→ webhook ─→ sync ─→ curate ─→ review queue
                                                   │
                                          you approve (one click)
                                                   ├─→ /api/portfolio/{slug} is live immediately
                                                   ├─→ commit / PR into your site repo
                                                   └─→ optional: share to LinkedIn
```

Approving or editing an item queues a site publish, coalesced per user per minute so approving five things in a row produces one commit. Repo writes never run inline in the request that approved an item.

## LinkedIn (publishing only — one-way by necessity)

LinkedIn is asymmetric, and the asymmetry is LinkedIn's, not ours.

| Direction | Supported | Why |
| --- | --- | --- |
| **Publish** a portfolio item as a LinkedIn post | **Yes** | The self-serve *Share on LinkedIn* product grants `w_member_social`. The app posts via `POST /rest/posts`. |
| **Import** your LinkedIn posts | **No** | Reading a member's own posts needs `r_member_social`, which LinkedIn documents as restricted to approved partners. There is no self-serve path. |
| **Import** your headline, roles, education, skills | **No** | *Sign In with LinkedIn (OpenID Connect)* returns only `sub`, `name`, `given_name`, `family_name`, `picture`, `locale`, `email`. The profile/positions APIs have been partner-gated since 2019. |

So LinkedIn history is entered through **Import evidence** (pick *Role / position*, source label *LinkedIn*, paste the permalink), and is then curated and filed exactly like discovered evidence. LinkedIn is never scraped.

### Setup

1. Create an app at <https://www.linkedin.com/developers/apps>.
2. On the **Products** tab add both, and wait until each shows as granted:
   - *Sign In with LinkedIn using OpenID Connect* → `openid`, `profile`, `email`
   - *Share on LinkedIn* → `w_member_social`
3. **Auth** tab → authorized redirect URL: `$APP_URL/api/integrations/linkedin/callback`
4. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
5. Connect from **Sources → Publishing**, then use **Share on LinkedIn** on any item in **Portfolio**.

Nothing is ever posted automatically. Publishing is a per-item action: the app drafts the text from the item's own facts, shows it, and posts only what you confirm. Drafts restate the evidence and invent nothing.

Notes: member access tokens last ~60 days and refresh tokens are partner-only, so the app prompts to reconnect on expiry. LinkedIn caps members at 150 posts/day; this app additionally throttles to 20/hour. Post text is encoded for LinkedIn's `little` format, which reserves ``| { } @ [ ] ( ) < > # * _ ~ \`` and requires escaping all of them — `#hashtags` are converted to LinkedIn's hashtag template so they still render as tags. `LINKEDIN_API_VERSION` pins the monthly API version (default `202608`).

## Restricted (no fake connectors)

Hashnode retired free GraphQL API access on 2026-05-13 — reading now requires a paid Pro plan, and the unauthenticated endpoint redirects to their announcement. Devpost has no public user API. Notion and Google Drive exist as APIs but are deferred (sharing model / invasive scanning). Import evidence manually instead.

A connector is only listed as live if it works against the vendor's official API today. `src/lib/sources/catalog.test.ts` fails the build if a `live: true` entry has no adapter behind it.

## AI curation

If `OPENAI_API_KEY` is set, the worker asks the model to classify using **only** fetched facts. If it is unset, a transparent heuristic curator runs (stars, releases, README substance, trivial PR titles, recency, target-role overlap). Uncertain fields are labeled; numbers are never invented.

Rejected items stay rejected unless the payload hash changes.

## Portfolio sections

Approved evidence files itself into a section automatically — nothing needs to be sorted by hand. The mapping is total, so no item can fall off the page:

| Evidence kind | Section |
| --- | --- |
| `role` | Experience |
| `project` | Projects |
| `package`, `contribution` | Open source |
| `article` | Writing & talks |
| `publication` | Publications |
| `certification` | Credentials |
| `achievement` | Achievements |

Two cases are routed by source rather than kind, because the kind alone is ambiguous: an npm "project" and a GitHub fork both belong under Open source. Sections render in the order above on `/p/{slug}` and on **Portfolio**, and empty sections are omitted. See `src/lib/portfolio/sections.ts`.

## Environment

See `.env.example`. Important keys:

- `DATABASE_URL` — Postgres
- `REDIS_URL` — Redis
- `AUTH_SECRET` — Auth.js
- `APP_ENCRYPTION_KEY` — token encryption
- `OPENAI_API_KEY` — optional
- `CRON_SECRET` — cron endpoint
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_API_VERSION` — optional, publishing only

In production `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, and `CRON_SECRET` must each be at least 32 characters and must not be the placeholder text from `.env.example`. `src/lib/env.ts` validates the whole environment on import, so a misconfigured deploy fails at startup with a readable message instead of at the first request.

## Tests

```bash
npm test
```

Covers the heuristic curator, evidence fingerprinting, the rejected-item reopen policy, catalog/adapter drift, portfolio section routing, OAuth state signing and expiry, and LinkedIn text encoding.

The suite is hermetic — `vitest.config.ts` supplies its own environment, so it does not depend on a local `.env` and runs unchanged in CI.

```bash
npm run verify   # typecheck + lint + test
```

## Notes

- The package is ESM (`"type": "module"`), because `octokit` v5 is ESM-only and the BullMQ worker imports it.
- If Redis is unreachable, `enqueueSourceSync` gives up after `QUEUE_ENQUEUE_TIMEOUT_MS` (default 3000) and runs the sync inline. BullMQ requires `maxRetriesPerRequest: null`, so without that bound a down Redis would hang the request instead of falling back.
- Sync jobs are de-duplicated per connection per minute, so a burst of webhooks collapses into one job while the next cron tick still gets through.

## Deploying

```bash
cp .env.example .env.production   # then fill in real secrets
npm run docker:prod               # builds and starts web + worker + migrate + postgres + redis
```

`docker-compose.prod.yml` runs `prisma migrate deploy` to completion before web and worker start, and — unlike the dev compose file — publishes no database or cache port to the host. Put a TLS-terminating reverse proxy in front of `web`.

The image is multi-stage: `runner` serves the Next.js standalone output as a non-root user, and `worker` runs the BullMQ consumer from the same source. Both are in one `Dockerfile`.

### What is hardened

| Area | Behaviour |
| --- | --- |
| Config | `src/lib/env.ts` validates every variable on import and refuses to boot in production on a weak or placeholder secret |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed; `/app/*` and `/api/*` set no-store |
| Auth | Sign-in throttled inside the Credentials `authorize` callback — the chokepoint a direct `POST /api/auth/callback/credentials` also passes through — bucketed by both client and account; sign-up throttled and race-safe |
| Secrets | Source credentials and LinkedIn tokens encrypted with AES-256-GCM; cron bearer compared in constant time; OAuth `state` signed and valid for 10 minutes |
| Health | `GET /api/health` checks Postgres and Redis. Postgres down → 503; Redis down → `degraded` but still 200, since sync falls back inline |
| Shutdown | The worker drains in-flight jobs on SIGTERM (25s cap) so a deploy never abandons a half-finished sync |
| Overload | Cron only enqueues — it never falls back to running a whole batch inline — and returns 503 if the queue is unreachable |
| SEO | `generateMetadata` with OpenGraph on `/p/{slug}`, plus `robots.txt` and a `sitemap.xml` listing only public, non-empty portfolios |

### Operational notes

- Point a scheduler at `GET /api/cron/sync` with `Authorization: Bearer $CRON_SECRET` every ~5 minutes.
- Scale `worker` replicas independently of `web`; `SYNC_CONCURRENCY` sets per-replica parallelism.
- `APP_ENCRYPTION_KEY` cannot be rotated without re-encrypting stored credentials — rotating it invalidates every connected source and LinkedIn token.

## Product paths

- `/` landing
- `/app` dashboard
- `/app/sources` connectors
- `/app/discoveries` filterable evidence
- `/app/reviews` approval queue
- `/app/portfolio` published items
- `/p/{slug}` public profile
- `/api/portfolio/{slug}` public JSON feed (CORS-open)
- `/embed.js` drop-in renderer for any website
- `/api/health` liveness/readiness probe
