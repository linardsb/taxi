# Sakta Cab — deploy guide

Two halves: **Google side** (you, ~10 min, needs your login) and **Cloudflare side**
(one login from you, then Claude can run the commands). Everything is free tier.

Resolved decisions: Cloudflare Pages project **`sakta-cab`** → `https://sakta-cab.pages.dev`,
deployed by direct upload (`npx wrangler pages deploy`, no git needed); backend installed
by pasting `backend/Code.gs` into Apps Script.

---

## A. Google side (~10 min, once)

1. **Open** [script.new](https://script.new) in a browser logged in as **linardsberzins@gmail.com**.
2. Name the project (top-left "Untitled project") → `Sakta Cab API`.
3. **Paste** the entire contents of `backend/Code.gs` over the default code. Save (⌘S).
4. **Run `setup`**: in the toolbar function dropdown pick `setup` → **Run**.
   - An authorization dialog appears: *Review permissions* → pick your account →
     "Google hasn't verified this app" → **Advanced** → *Go to Sakta Cab API (unsafe)* → **Allow**.
     (It's your own script in your own account — the warning is standard for unpublished scripts.
     Scopes: Sheets + Drive it creates, and sending mail to yourself.)
   - Run `setup` again if the first run was consumed by the authorization.
5. **Read the Execution log** (bottom panel). It prints:
   - the **Sheet** URL (`Sakta Cab — atbildes`) and **Drive folder** URL (`Sakta Cab`),
   - **TOKEN_ANKETA** (Atis & Dina's secret) and **TOKEN_ADMIN** (yours).
   Save these somewhere private.
6. **Deploy**: blue **Deploy → New deployment** → gear icon → **Web app** →
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** → copy the **Web app URL** (ends in `/exec`).
7. Quick check: open that `/exec` URL in the browser → it should say `Sakta Cab API — OK`.
8. **Give the `/exec` URL to Claude** → it goes into `app/config.js` (`apiUrl`).

> **Pasted an older Code.gs already?** Paste the current one over it — then if you had
> already deployed, use the update path below; if not, just continue with step 6.
>
> **Updating backend code later:** paste the new code, then **Deploy → Manage deployments →
> ✏️ → Version: New version → Deploy**. The `/exec` URL stays the same — never create a
> second "New deployment" or the URL changes.

## B. Cloudflare side (once)

1. **You**: run `npx wrangler login` in a terminal (or type `! npx wrangler login` in the
   Claude session) — a browser tab opens, approve access. That's your only step.
2. **Claude** (or you) then runs:

```bash
cd /Users/Berzins/Desktop/taxi
npx wrangler pages project create sakta-cab --production-branch=main
npx wrangler pages deploy app --project-name=sakta-cab --branch=main
```

3. The site is live at **https://sakta-cab.pages.dev** (a per-deploy preview URL is also printed).

> **Updating the frontend later:** edit files in `app/`, run the same
> `npx wrangler pages deploy app --project-name=sakta-cab --branch=main`. ~10 seconds.

## C. Wire-up (2 min)

1. `app/config.js` → `apiUrl: '<your /exec URL>'` (Claude does this), then redeploy Pages.
2. In Apps Script **⚙ Project Settings → Script Properties**, check two properties
   (`setup()` pre-seeds them; adjust if needed):
   - **APP_URL** = `https://sakta-cab.pages.dev` — makes emails carry clickable links.
   - **RESP_EMAILS** = `atisvikis@gmail.com, <dina's email>` — recipients of the
     **📣 Paziņot Atim & Dinai** digest button (one summary email of all open precizējumi).

## D. Smoke test (5 min, before sending links)

1. Open `https://sakta-cab.pages.dev/?t=<TOKEN_ANKETA>` — intro screen appears, "DEMO" chip is **gone**.
2. Answer one question, drop in any screenshot → wait for **"Saglabāts ✓"**.
3. Check: a row appears in the Sheet, the file appears in `Sakta Cab/Sadaļa N/` in Drive.
4. Open `https://sakta-cab.pages.dev/?t=<TOKEN_ADMIN>` → the answer is there → **✓ Apstiprināt**.
5. Reload the anketa link → the answer shows the green ✓ badge.
6. Mark a section complete → email arrives at linardsberzins@gmail.com with the admin link.
7. Clean up: in Apps Script run **`resetAnswers`** (wipes test rows + completed list; tokens/URL untouched), delete the test file from the Drive folder.

## E. Send the links

- **Atis & Dina** (one shared link): `https://sakta-cab.pages.dev/?t=<TOKEN_ANKETA>`
- **You only**: `https://sakta-cab.pages.dev/?t=<TOKEN_ADMIN>` — bookmark it; every
  section-completed email also carries it.

## Notes

- **Cost**: €0. Cloudflare Pages free tier (500 builds/mo, unlimited requests for static),
  Apps Script free quotas (consumer: ~20k URL executions/day, 100 emails/day) — two
  respondents won't scratch them.
- **Privacy**: the page is `noindex`; access is only via the two unguessable tokens.
  Uploaded files are "anyone with the link can view" (needed so images display in the
  questionnaire without Google login) — links are unguessable and live only inside the
  Sheet and the questionnaire.
- **Payload limit**: images are compressed in the browser to ≤ ~2 MB before upload; PDFs
  capped at 8 MB — well inside Apps Script POST limits.
