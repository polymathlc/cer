# polymath-cs — the server behind polymathlc.com.sg/cs

The `/cs` page (`cs/index.html`) offers free downloads. A visitor flips through
an animated booklet made from the file's own pages, then unlocks the download
with their **name, email, WhatsApp number** and a **tick agreeing to marketing
by email and WhatsApp**. The admin (chungzhikai@gmail.com) signs in on the same
page to upload files, choose which are downloadable, choose the booklet pages,
make a share clip, make a 🖼 social post (a square, portrait or story picture for
Instagram, Facebook and WhatsApp that sends parents to the page), and read or
export the people who signed up. The social post is drawn entirely in the
admin's browser and needs nothing from this codebase beyond the admin link the
booklet already uses to read the stored file.

This folder is the Cloud Functions codebase **`polymath-cs`** in the shared
`mathgen--app` project.

| Function | Kind | Who | What |
| --- | --- | --- | --- |
| `csListFiles` | callable | anyone | page text, the consent wording + version, the downloadable files and their booklet pages — never a storage path |
| `csUnlock` | callable | anyone | validates, rate-limits, records the lead and its consent, returns a 24-hour download link |
| `csDownload` | HTTP GET | link holder | spends one use of a link (6 per link) and **streams** the file |
| `csAdmin` | callable | admin only | files, uploads, booklet pages, featured file, page text, leads, consent withdrawal, erasure |

## Data — all server-only

| Collection | Holds |
| --- | --- |
| `csFiles/{fileId}` | title, description, published, order, storage path, size, type, booklet pages, counters |
| `csLeads/{leadId}` | one row per email: name, email, WhatsApp (E.164), the consent text + version + time, history |
| `csLeads/{leadId}/unlocks/{id}` | one row per unlock: file, time, details given, consent version (no raw IP) |
| `csLimits/{key}` | hourly counters (per address, per email, overall) |
| `csGrants/{sha256(key)}` | download links — only the HASH of the key is stored |
| `csSettings/main` | the page's headline, introduction and thank-you text |

Storage: the files live in `cs-files/{fileId}/…` (never public); the booklet
pages live in `cs-previews/{fileId}/…` and are public through download-token
URLs, because their job is to show what is inside before anyone signs up.

The shared Firestore catch-all is open, so **`tools/cs-rules.mjs` must be
published** to lock these five collections away from every browser. Run
*Actions → /cs rules → Run workflow* (test), then again with **apply** ticked.

The shared Storage rules were open as well, so `cs-files/` could be read or
listed directly. **`tools/cs-storage-rules.mjs`** closes that folder (only the
verified admin may upload into it; nobody reads it except the server) after a
dry run proves every other folder answers exactly as before:
*Actions → /cs Storage rules → Run workflow* with **apply** ticked.

## Deploying

A push to `main` that touches `cs-function/**` runs
`.github/workflows/deploy-cs.yml`, which tests, deploys `--only
functions:polymath-cs`, and then checks the live service from the outside
without creating anything. It uses the existing `FIREBASE_SERVICE_ACCOUNT`
repository secret. Nothing here deploys Firestore or Storage rules.

## Tests

```
npm test --prefix cs-function/functions        # the service, against in-memory fakes
node --test tools/cs-page-tests.mjs             # the page's own rules vs the server's
node --test tools/cs-rules-tests.mjs            # the rules patch
PW=…/playwright/index.mjs PDFJS_DIR=…/pdfjs-dist@3.11.174 PDFLIB=…/pdf-lib JSQR=…/jsqr node tools/cs-page-browser.mjs
```

The browser check runs the real page with the real service code behind a
Firebase stub: upload a PDF, draw the booklet, record a clip, make and save
the social posts in all three sizes (scanning their QR codes with jsQR when
`JSQR` is set), unlock with consent, stream the download, read and export the
lead, hide a file, and the 360px phone layout. The pictures it saves are left
in `test-results/cs-page/` to be looked at.
