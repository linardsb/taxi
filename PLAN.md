# Sakta Cab — project plan

Interactive Latvian-language questionnaire for two respondents, as groundwork for a plan
to out-compete Bolt in Latvia with better driver conditions.
Resolved by interview 2026-07-06. Name (user's choice, 2026-07-06): **Sakta Cab** — replaces the earlier working name "Taxi aplikācija".

## 1. Goal

Exploratory, serving all three tracks at once:
1. **Competing service** — market research to design a driver-friendlier ride-hailing/taxi offering (commission model, pricing, feature backlog).
2. **Driver cooperative** — gauge appetite, investment willingness, recruiting reach.
3. **Evidence & advocacy** — document Bolt's commission practices and driver treatment (screenshots as exhibits for Konkurences padome / media, if it comes to that).

Questions are deliberately **unorthodox** (scenario & role-swap, day reconstruction, trade-off games, design-it exercises) so answers translate directly into service features, not survey noise.

## 2. Respondents

Strictly two, forever (no mass-survey design):
- **Atis** — cousin, cab driver in Latvia, works with Bolt (~30% effective commission); also the business partner on the platform build.
- **Dina** — his wife, dispatcher at Riga bus station (autoosta) — and the **planned dispatcher of the new service**. Her sections translate autoosta experience to taxi dispatch and design her future console and working terms.

**One combined answer pool** (changed 2026-07-06 from two personal questionnaires, per Linards): a single shared respondent link (`?t=<token>`), all 11 sections in one questionnaire. Every answer carries a `by` tag — Atis / Dina / Abi. Sections 1–6 are fixed to Atis, 7–9 to Dina, shared sections 10–11 have a per-question toggle (default Abi). No login.

## 3. Product & UX

- **Fully interactive custom HTML page. Nothing Google-branded is ever visible to respondents** — Google is invisible storage only. (Google Forms explicitly rejected.)
- Entirely in **Latvian**, informal **"tu"** (family).
- **Computer-first**, responsive enough to open the same link on the phone to fling screenshots in.
- **Multi-evening format**: 11 sections × 10–20 min (~2–3 h total for him, ~1 h for her). Autosave on every answer (debounced POST + localStorage mirror), resume from the same link, per-section progress bar.
- **Every question**: drag-and-drop screenshot zone (multiple files, images + PDF, client-side compression before upload) and a "Izlaist" (skip) option. Exact numbers requested, skip as the escape hatch.
- 📎 markers on questions where evidence is especially expected (Bolt weekly earnings, per-ride commission breakdowns, penalty notices, support chats).

## 4. Architecture

- **Frontend**: static single-page HTML/CSS/JS (vanilla, no framework), hosted on **Cloudflare Pages** — project `sakta-cab` → **https://sakta-cab.pages.dev**, deployed by direct upload (`npx wrangler pages deploy app`, no git). One-time `wrangler login` by Linards; each update is one command.
- **Backend**: **Google Apps Script** web app (execute-as-owner, "Anyone" access) as a JSON API — the standard `text/plain` POST pattern to avoid CORS preflight. Installed by guided manual paste (script.new) of `backend/Code.gs`; `setup()` auto-creates Sheet + Drive folder + both tokens; updates ship as "New version" on the same deployment so the /exec URL never changes.
  - Actions: `getState`, `saveAnswer`, `uploadFile`, `deleteFile`, `sectionComplete`, admin: `setStatus` (full contract in `app.js` header).
- **Storage** (all in Linards' Google account):
  - Google Sheet `Sakta Cab — atbildes`: one row per question: answer JSON, `by` tag (atis/dina/abi), timestamps, screenshot Drive IDs, status, admin comment. Second tab logs section completions.
  - Google Drive folder `Sakta Cab/Sadaļa N/` for screenshots (files link-viewable so they render in the app without Google login).
- **Auth**: two random tokens (anketa / admin) in Script Properties. No other auth.
- **Notifications**: email to linardsberzins@gmail.com on each section completion; reverse direction (added 2026-07-06): admin **📣 digest button** sends Atis & Dina one summary email of all open precizējumi (recipients in `RESP_EMAILS` Script Property).

## 5. Review / approval workflow (required feature)

Admin link opens **review mode** in the same app: answers + screenshots side by side, per answer:

| Status | Meaning | Visible to respondent |
|---|---|---|
| (grey) Nav pārskatīts | not yet reviewed | neutral |
| ✓ Apstiprināts | looked through & approved | green check |
| ❓ Vajag precizēt + comment | follow-up question from Linards | orange badge + comment |
| ↻ Atjaunots | respondent edited after a comment | back in review queue |

Answers stay editable; editing after review resets status to ↻. Statuses also land in the Sheet. This turns the multi-evening format into a dialogue.

## 6. Privacy

Light-touch: intro screen states what the data is for, that it lives in Linards' private Drive, and that every question is skippable. Every upload zone reminds: blur/crop passenger names, addresses, phones. Dispatcher section additionally warns: nothing that breaches her employment confidentiality (no internal employer data).

## 7. Questionnaire content

Full Latvian question set: **JAUTAJUMI.md** (review this first — build order step 1).
Sections: Atis 1–6 (Profils · Naudas realitāte · Izmaksas · Attiecības ar Bolt · Darba diena · Konkurenti & pāreja), Dina 7–9 (Darbs autoostā · Taksometru plūsma ap autoostu · Tava dispečerpults — framed for her as the service's future dispatcher), both 10–11 (Vīzija & nosacījumi · Brīvais mikrofons + pierādījumu kaste).

## 8. Build order

1. ✅ This plan.
2. ✅ **JAUTAJUMI.md** — question set approved 2026-07-06, content built 1:1 into the app.
3. ✅ **Frontend built**: `app/` (index.html · styles.css · questions.js · app.js · config.js) — vanilla JS SPA, no framework, no build step. Demo mode fully functional in-browser (localStorage + IndexedDB for screenshots); live mode activates by setting the Apps Script URL in `config.js`. API contract documented in the header of `app.js`. Verified: 40/40 jsdom interaction tests + headless-Chrome render checks (76 questions in one combined pool, all widget types, by-tags, skip/autosave/complete, admin approve→comment→respondent-sees→edit→re-review loop).
4. ✅ **Backend + deploy guide written**: `backend/Code.gs` (full API per contract, plus `setup()` and `resetAnswers()`) and `DEPLOY.md` (click-by-click). Execution pending on Linards: Google-side setup (~10 min, section A) and one `npx wrangler login`; then the deploy commands run from here.
5. After both finish: synthesis report — findings + the actual anti-Bolt plan (service design, cooperative option, evidence dossier).

## 9. Decided against

- Google Forms in any role (rigid, google-y, clunky uploads).
- Mass-survey design, respondent accounts/logins, PIN on admin link.
- Cloudflare R2/D1 for data (storage must be Drive/Sheets), live dashboards, Apps Script-served HTML (Google banner), local HTML file distribution.
- Strict blur-gating of uploads (light hints instead).
- Two separate answer stores / per-person personal links (replaced 2026-07-06 by one combined pool with per-answer Atis/Dina/Abi tags).

## 10. Open items

- Tokens: auto-generated by `setup()` during Google-side setup (DEPLOY.md section A).
- When they start (affects nothing structural).
