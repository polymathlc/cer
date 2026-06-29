/**
 * Science Quest — automated practice reminders (OPTIONAL backend).
 *
 * Runs on a schedule (every 3 days) and emails students who haven't practised
 * in the last 3 days a "come back and practise" nudge containing a one-click
 * link to the practice page. Sending is done by enqueuing a document into the
 * `mail` collection that the Firebase "Trigger Email" extension watches — so
 * this function never needs SMTP credentials itself.
 *
 * It reads the SAME Firestore data the web app already writes:
 *   - userProfiles      (uid, email, displayName, role)   -> who to email
 *   - questionAttempts  (uid, timestamp)                   -> last practice time
 *
 * Prereqs (one-time): see README.md in this folder.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ─── EDIT ME ──────────────────────────────────────────────────────────────
// The public URL of your deployed app. The #practice hash deep-links a
// signed-in student straight onto the practice page.
const APP_URL = "https://YOUR-APP-DOMAIN/index.html";
// Remind a student if their last practice was this many days ago (or never).
const REMINDER_DAYS = 3;
// ──────────────────────────────────────────────────────────────────────────

const PRACTICE_LINK = APP_URL + "#practice";

function reminderEmail(name) {
  const hi = name ? `Hi ${name}!` : "Hi!";
  const subject = "🔬 Time to practise on Science Quest — win prizes!";
  const text = [
    hi,
    "",
    "It's been a few days since your last Science Quest practice. Jump back in and answer a few questions to climb the leaderboard.",
    "",
    "🎟️ Practise 10+ questions a day for 30 days in a row to win a $10 Popular voucher.",
    "🎁 The top 5 students each month (most questions done) also win a $10 Popular voucher each.",
    "",
    "👉 Practise now: " + PRACTICE_LINK,
    "",
    "See you in class!",
  ].join("\n");
  const html = `<p>${hi}</p>
<p>It's been a few days since your last Science Quest practice. Jump back in and answer a few questions to climb the leaderboard.</p>
<ul>
  <li>🎟️ Practise <b>10+ questions a day for 30 days in a row</b> to win a <b>$10 Popular voucher</b>.</li>
  <li>🎁 The <b>top 5 students each month</b> (most questions done) also win a <b>$10 Popular voucher</b> each.</li>
</ul>
<p><a href="${PRACTICE_LINK}" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">👉 Practise now</a></p>
<p>See you in class!</p>`;
  return { subject, text, html };
}

// "0 9 */3 * *" = 09:00 every 3rd day. Adjust timeZone to suit your students.
exports.practiceReminders = onSchedule(
  { schedule: "0 9 */3 * *", timeZone: "Asia/Singapore" },
  async () => {
    const cutoff = Date.now() - REMINDER_DAYS * 86400000;

    // 1) All non-admin students with an email.
    const profSnap = await db.collection("userProfiles").get();
    const students = [];
    profSnap.forEach((d) => {
      const p = d.data();
      if (p.role !== "admin" && p.email && p.uid) {
        students.push({ uid: p.uid, email: p.email, name: p.displayName || "" });
      }
    });

    // 2) For each, find their most recent attempt; flag if stale/none.
    let queued = 0;
    for (const s of students) {
      let lastMs = 0;
      try {
        const aSnap = await db
          .collection("questionAttempts")
          .where("uid", "==", s.uid)
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();
        if (!aSnap.empty) {
          const ts = aSnap.docs[0].data().timestamp;
          lastMs = ts && ts.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
        }
      } catch (e) {
        logger.warn("attempt lookup failed for " + s.uid, e);
      }
      if (lastMs > cutoff) continue; // practised recently — skip

      // 3) Enqueue an email for the Trigger Email extension to send.
      const { subject, text, html } = reminderEmail(s.name);
      await db.collection("mail").add({
        to: [s.email],
        message: { subject, text, html },
      });
      queued++;
    }
    logger.info(`practiceReminders: queued ${queued}/${students.length} reminder email(s).`);
  }
);
