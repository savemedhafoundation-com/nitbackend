# Ebook implementation and setup

The feature extends the existing three applications. It uses the existing React/Vite
public site (`nit`), hash-based React/Vite admin (`nitAdmin`), and Express/Mongoose
backend (`nitbackend`). Existing Cloudinary blog/case-study uploads are unchanged.

## Frontend

- `/ebooks`: server-paginated library with search, category filtering, covers, metadata,
  loading skeletons, empty/error states, and permitted downloads.
- `/ebooks/:id`: details plus the PDF.js reader, with selectable text, page controls,
  zoom, keyboard navigation, retry, and mobile layouts.
- Ebooks is integrated into desktop navigation, mobile navigation, and mobile page search.
  Its active state includes detail routes. The supplied screenshot was a design reference.
- New components: `EbookCard`, `EbookCover`, `DownloadEbookButton`, and `PDFReader`.
- The PDF worker loads only on reader routes. PDF.js requests ranges with streaming and
  automatic whole-file prefetch disabled; one page canvas is retained at a time.
  PDF bytes are never converted to base64 or stored in React state.
- PDF.js fonts, CMaps, WASM and ICC resources are copied from the installed package
  before development/build; no third-party PDF viewer service or asset CDN is required.

## Admin

Open `/#ebooks` in `nitAdmin`. The existing `/api/auth/login` and `/api/auth/me`
endpoints validate an administrator account. The ebook session token stays in the
admin tab's session storage. No second authentication service was introduced.

Admins can search/filter/page through ebooks; create drafts; edit title, author,
description, category, tags, publication date and download permission; upload or
replace a PDF/cover; publish, unpublish, and delete. Upload controls support file
selection, drag/drop, measured byte progress, average speed, ETA, cancellation,
fresh-upload retry, and verification-only retry after a successful transfer.

The admin view also exposes pending upload/processing state and lets an admin
recover or cancel an upload left by an earlier session. Dialogs use the existing
visual patterns and a document-level portal so they work above the mobile sidebar.

## API and authorization

All paths below are relative to `/api`. All admin paths, including configuration,
upload authorization, completion and cancellation, require an existing valid JWT
and the current database user's `admin` role. Public registration always creates
a `patient`; clients cannot self-register as administrators.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ebooks` | Published library; `page`, `limit`, `q`, `category` |
| GET | `/ebooks/:id` | Published metadata plus short-lived direct PDF/cover links |
| POST | `/ebooks/blob-callback` | SDK-authenticated upload completion callback |
| GET | `/admin/ebooks/config` | Limits, allowed cover types, storage readiness |
| GET | `/admin/ebooks` | Admin listing; also accepts `status` |
| POST | `/admin/ebooks` | Create metadata-only draft |
| GET | `/admin/ebooks/:id` | Admin details and pending upload sessions |
| PATCH | `/admin/ebooks/:id` | Allowlisted metadata only |
| DELETE | `/admin/ebooks/:id` | Hide ebook and delete associated storage safely |
| POST | `/admin/ebooks/:id/publish` | Publish only a verified PDF without a pending PDF upload |
| POST | `/admin/ebooks/:id/unpublish` | Withdraw from the public library |
| POST | `/admin/ebooks/:id/uploads` | Authorize an exact generated path/type/size |
| POST | `/admin/ebooks/:id/uploads/:uploadId/complete` | Verify and attach uploaded object |
| POST | `/admin/ebooks/:id/uploads/:uploadId/cancel` | Cancel and retain cleanup work |
| GET | `/internal/ebooks/cleanup` | Retry cleanup; requires `CRON_SECRET` bearer authorization |

Lists return `{ data, pagination: { page, limit, total, pages }, categories,
assetUrlsExpireAt }`. Detail/create/update/complete actions return an ebook object.
Public lists omit PDF URLs and storage management fields. All ebook API responses
are `Cache-Control: private, no-store`; errors do not expose raw database, JWT or
storage errors, stack traces, management credentials, or signed request URLs.

## Blob storage and validation

Connect a **private Vercel Blob store** to the backend. This is intentional: drafts
and unpublished files must not have publicly readable URLs. The current official
SDK supports scoped, expiring URLs for direct reads without an application proxy.
See [Vercel signed URLs](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob).

The backend issues `generateClientTokenFromReadWriteToken` credentials scoped to a
single generated pathname, exact MIME type and declared size, valid for 12 hours,
with overwriting disabled. The browser uses `put` from `@vercel/blob/client` with
`multipart: true`, `onUploadProgress`, and `abortSignal`. Neither the upload nor the
download body passes through Express.

Paths are generated server-side, with UUID filenames:

```text
ebooks/{ebookId}/pdf/{uuid}.pdf
ebooks/{ebookId}/cover/{uuid}.jpg|png|webp
```

After upload, the server verifies HEAD metadata, the configured store host,
pathname, exact declared size, maximum size and MIME type. PDF validation reads at
most a 1 KiB header, 64 KiB trailer and 4 KiB cross-reference segment, checks the PDF
signature/version, EOF/startxref, and classic or stream cross-reference structure.
It requires correct bounded range responses and refuses redirects before sending
storage credentials. Covers are checked against JPEG/PNG/WebP signatures.

This is lightweight format validation, not an antivirus scan or a complete PDF
conformance parser. PDF.js reports unreadable/password-protected documents safely.
Covers preserve their supplied supported format; no new image-processing system
was introduced just for this feature.

An ebook becomes `READY` only after verification. A replacement keeps the previous
PDF/cover until the new object is valid and the metadata update succeeds. Atomic
pending-upload and revision checks prevent a late callback, cancellation, deletion,
or competing upload from attaching an obsolete file.

Public readers can obtain fresh links only for `PUBLISHED` ebooks. Direct signed
read links expire after 15 minutes, and the reader renews them before expiry while
preserving page and zoom. **Already-issued links remain valid until expiry after
unpublishing**, and already-downloaded copies cannot be revoked. Download permission
controls the application button; it is not DRM.

## Database and cleanup

Mongoose collections:

- `Ebook`: metadata, Blob URLs/pathnames, byte size, visibility/status, dates and
  creator, plus pending-upload references and a durable deletion outbox.
- `EbookUpload`: path/type/size authorization metadata, lifecycle state, expiry and
  cleanup work. No file bytes or read/write tokens are stored in either collection.

Indexes cover published/status filtering, category, creation date, title/text
search, upload lookup/expiry and cleanup. `npm run migrate:ebooks` adds the indexes
idempotently without dropping existing application data or indexes.

Deletion immediately hides an ebook. If Blob deletion fails, a tombstone and the
exact paths are retained until cleanup succeeds. Cancellation tombstones survive
their upload token's lifetime to handle delayed multipart completions. Replacement
paths are queued in the same atomic update that attaches the new file.

The SDK completion callback verifies the Vercel signature. A daily Vercel Cron at
03:00 UTC retries pending/expired uploads, superseded files and deletion outboxes.
`npm run cleanup:ebooks` runs the same routine manually or from an external scheduler.
Do not remove upload records with a database TTL: that could discard pending cleanup.
Vercel Cron runs on production deployments; preview/local environments should use
manual cleanup or their own scheduler when doing real storage uploads.

## Configuration and deployment

Use **Node.js 22.13 or newer** and npm in all three directories. Install each app's
lockfile with `npm ci`. Keep existing application credentials/configuration intact.

On the backend, use `.env.example` as a template for untracked local values or the
deployment's environment settings:

```dotenv
BLOB_READ_WRITE_TOKEN=
EBOOK_MAX_SIZE_BYTES=524288000
EBOOK_COVER_MAX_SIZE_BYTES=5242880
CRON_SECRET=
EBOOK_UPLOAD_CALLBACK_URL=
```

- `524288000` is 500 MiB, displayed as **500 MB** to match the requested UI.
  A lower PDF limit is supported; a higher or invalid configured limit fails closed.
- Cover default: 5 MiB, configurable up to 10 MiB.
- Existing `MONGO_URI` (or `MONGODB_URI`), `JWT_SECRET`, `CLIENT_URL` and `ADMIN_URL`
  remain in use. The CORS origins must include the actual public/admin deployments.
- The upload callback URL is optional locally because the browser also finalizes.
  On Vercel, production uses its production hostname, and previews use their own
  deployment hostname. Set the explicit HTTPS callback URL when a custom routing
  setup is needed. It must reach this backend and allow signed server callbacks
  through deployment protection; a localhost callback needs an HTTPS tunnel.
- Set a strong server-only `CRON_SECRET` in Vercel for scheduled cleanup.
- In `nit`, set `VITE_API_URL` to the backend API URL. In `nitAdmin`, set
  `VITE_API_BASE_URL`. **Never use a `VITE_` prefix for Blob or database credentials.**

For an existing trusted account that needs admin access, an operator with database
access can run `npm run admin:grant -- account@example.com` in `nitbackend`.
This script is never exposed as an HTTP endpoint and was not run against a real account.

Deploy backend changes and run `npm run migrate:ebooks` against the target database
before deploying the two frontend builds. Then verify a small real PDF upload,
callback, read, replacement and deletion using your connected private Blob store.

## Verification

Each application provides `lint`, `type-check`, `test:unit`, `test:integration`, and
`build` scripts. Type checking covers the new feature and its imported boundaries;
existing JavaScript applications were not rewritten into a new framework.

Final verification after dependency updates on 2026-08-31:

| Application | Unit tests | Integration tests | Lint | Type check | Production build |
|---|---:|---:|---|---|---|
| Public site (`nit`) | 24 passed | 10 passed | Passed | Passed | Passed |
| Admin (`nitAdmin`) | 19 passed | 16 passed | Passed, two existing hook warnings | Passed | Passed |
| Backend (`nitbackend`) | 40 passed | 89 passed | Passed | Passed | Passed |

**198 tests passed.** All three `git diff --check` commands passed. The backend
`check:migrations` command passed against disposable MongoDB, including repeated
index creation. Production builds retain an existing admin main-bundle size warning
and public browser-compatibility-data update notices; neither fails the build.

Compatible dependency security updates were applied without forced major upgrades.
The backend audit is clean. The public app retains four existing AI SDK dependency
advisories (one high, one moderate, two low); no update within its current major
version resolves them. See the [dependency audit](../nit/docs/dependency-audit.md).
The admin retains three low-severity advisories through its existing Quill editor.
These older integrations were not replaced or forcibly downgraded as part of ebooks.

The backend also provides `check:migrations`, which always uses disposable MongoDB
and repeats index creation to check idempotence. Storage operations are mocked in
tests, including exact-500-MiB, one-byte-over-limit, malformed PDF/cover, failed
metadata persistence, interrupted uploads, callbacks, cancellation/replacement
races, deletion retry and authorization. CI never uploads a 500 MiB file.

Browser verification used desktop and 390-pixel mobile layouts, the actual local
Express API with disposable MongoDB, and the test-only `tests/previewServer.js`.
Its virtual valid 500 MiB PDF rendered both pages and supported zoom with two
256 KiB range reads; including the aborted initial GET, under 1 MiB was sent for
the first render. The fixture allocates neither a full PDF nor a large disk file.
Its direct uploads are disabled; it is not part of the production application.

The initial implementation checks did not use production credentials. The later
authorized production rollout below completed the live migration and storage checks.

## Production rollout — 2026-08-31

All three existing Vercel projects were deployed from the current working tree,
verified as production candidates, and promoted to their existing domains.

| Application | Live URL | Production deployment |
|---|---|---|
| Public site | [nit.care](https://nit.care) / [Ebooks](https://nit.care/ebooks) | `dpl_sqeqaiTeJuYymRoVFqKQpm2eMSFV` |
| Admin | [Ebook administration](https://nit-admin.vercel.app/#ebooks) | `dpl_9gv4WfqAdRFX1sJNY64MwT7DBrus` |
| Backend | [API health](https://nitbackend.vercel.app/api/health) | `dpl_BUNck3jBix3bLtzMdPzoFdnqQhJZ` |

Production configuration completed:

- Created the private `nit-ebook-pdfs` Blob store in `iad1` and connected it only
  to the backend's production environment. The read/write credential stays server-side.
- Configured the 500 MiB PDF limit, 5 MiB cover limit, signed upload callback URL,
  and a generated sensitive `CRON_SECRET`.
- Set both frontend API variables to `https://nitbackend.vercel.app/api`.
- Corrected an existing invalid production `NODE_ENV` value to `production`.
- Ran the additive ebook index migration against the existing production database.
- Confirmed Vercel Fluid Compute is enabled and daily cleanup is registered on the
  active backend deployment at 03:00 UTC.
- Added `.vercelignore` files to exclude local environment files, test fixtures,
  dependencies, and obsolete build output from source uploads.

Live verification:

- All three Vercel builds and production promotions succeeded; all active releases
  report `READY`. Vercel uses the existing Node.js 24.x project runtime.
- Repeated local verification passed all 198 tests, lint, type checks, production
  builds, and disposable migration checks. Disposable MongoDB startup timeout was
  increased to 60 seconds to tolerate concurrent build load; application logic was unchanged.
- A real 608-byte PDF uploaded using a scoped client token and multipart upload.
  Server metadata/PDF validation passed, signed reads and direct downloads returned
  HTTP 206, and unauthenticated private reads returned HTTP 403. Deletion was
  confirmed with a subsequent Blob HEAD check. No test ebook or user was created.
- The public candidate passed 20 HTTP checks for routes, compiled dependencies,
  PDF worker, and PDF.js support files, including nine matching artifact hashes.
- The live public library and admin sign-in screen rendered correctly in the browser.
  The library currently has no published ebooks.
- Live API health and ebook listing return HTTP 200. Admin and cleanup endpoints
  reject unauthenticated requests with HTTP 401. CORS allows both production frontend
  origins with credentials, and ebook responses remain private/no-store.
- The post-rollout 30-minute log scan found no backend HTTP 5xx responses and no
  frontend error entries. Two backend log entries were Node.js `url.parse()`
  deprecation warnings, not failed requests; these warnings were not suppressed.

An administrator was provisioned following the user's explicit request after
rollout. Production sign-in, profile identity, and ebook admin configuration/list
access were verified. The password is stored only as a bcrypt hash; no password or
session token is recorded here. No test ebooks were created. An authenticated
production upload through the admin UI was not exercised; the workflow has
automated coverage and the real Blob check above.

Existing external email/chat integrations were not exercised or reconfigured.
The dependency advisories documented above remain. No Git commits or pushes were
made; commit the local changes before a future Git-based release so those releases
include the same application source.
