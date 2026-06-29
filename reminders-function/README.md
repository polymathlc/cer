# Automated practice reminders (optional backend)

The Science Quest app is a single static HTML file, so it cannot send scheduled
email on its own — a browser only runs while a page is open. This folder is an
**optional** Firebase Cloud Function that runs server-side **every 3 days** and
emails students who haven't practised recently, with a one-click link straight
to the practice page (`index.html#practice`).

If you'd rather not run a backend, the app already has a built-in
**Admin → Usage → "Practice reminders"** panel that lists inactive students and
lets you email them in one click (copy BCC list / open a prefilled draft). This
function just makes that fully hands-off.

## What it does

- Reads the data the app already writes — no schema changes:
  - `userProfiles` → who to email (non-admin students with an email)
  - `questionAttempts` → each student's most recent practice time
- Anyone whose last attempt was **3+ days ago (or who never practised)** gets a
  reminder.
- It doesn't send mail directly. It drops a document into the `mail` collection,
  which the **Firebase "Trigger Email" extension** picks up and sends. That
  keeps SMTP credentials out of the function.

## Prerequisites (one-time)

1. **Blaze plan** — scheduled functions require the pay-as-you-go plan
   (free monthly quota usually covers a class easily).
2. **Install the "Trigger Email from Firestore" extension** and point it at the
   `mail` collection, configuring your sender (Gmail SMTP, SendGrid, etc.):
   ```
   firebase ext:install firebase/firestore-send-email
   ```
   When asked for the collection, use `mail`.
3. Firestore composite index for the per-student query
   (`questionAttempts` where `uid ==` + `orderBy timestamp desc`). The first
   deploy/run will log a link to click that creates it automatically.

## Configure

In `index.js`, set:

```js
const APP_URL = "https://YOUR-APP-DOMAIN/index.html"; // your deployed app URL
const REMINDER_DAYS = 3;                               // overdue threshold
```

Also adjust the schedule/timezone if you like (default `0 9 */3 * *`,
`Asia/Singapore` = 9am every 3rd day).

## Deploy

From this folder's parent (your Firebase project root). If you don't already
have a `firebase.json`, a minimal one for functions-only deploy:

```json
{ "functions": { "source": "reminders-function" } }
```

Then:

```bash
cd reminders-function && npm install && cd ..
firebase deploy --only functions:practiceReminders
```

## Test without waiting 3 days

In the Google Cloud console → Cloud Scheduler, find the
`firebase-schedule-practiceReminders-...` job and click **Run now**, then check
the `mail` collection and the function logs.
