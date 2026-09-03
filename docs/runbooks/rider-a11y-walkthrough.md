# Rider app — screen-reader walkthrough

The scripted audit the ux-metrics-ledger's Rider row 2 refers to ("audit script
lives in ticket"). Run it end to end **with the screen off or your eyes closed**.
A step that needs a glance is a failed step.

Screen-reader excellence is a launch differentiator for Sakta Cab, not a
fast-follow: blind riders are a named unserved segment (PRD §5, anketa S5-8), and
the two flows that break for them on every incumbent app — map-pin pickup
placement and vehicle identification — are the reason this app has no map on the
critical path at all.

## Result

| Field | Value |
|---|---|
| Run by | **not yet run** |
| Platform | — |
| App / OS version | — |
| Date | — |
| Outcome | **BLOCKED — see below** |

**AC #6 is blocked on hardware, and this file records that rather than
pretending otherwise.** A runbook with no run recorded is not a satisfied
acceptance criterion (plan risk R5).

- **VoiceOver (iOS): not performable on this machine.** The build machine is an
  iMac19,1, which cannot run Tahoe, so Xcode 26.3 is the ceiling; Expo SDK 57
  needs 26.4 to compile `expo-modules-jsi` for iOS. `observed` 2026-08-25.
- **TalkBack (Android): no emulator available.** `~/Library/Android/sdk/emulator`
  does not exist and Android Studio is not installed — `observed` 2026-09-02,
  during this ticket. `adb` is present but has nothing to talk to.

What ships as the gate instead is the RNTL suite: every assertable property in
the spec below is an automated assertion in `apps/rider/src/**/*.test.tsx`, and
they run on every `pnpm turbo run test`. What they cannot tell you is whether the
result is *pleasant* — that is what this walkthrough is for, and it is owed.

**When hardware exists:** run every step, fill the table above, and record each
step as pass or fail. Record failures as findings, never as "mostly worked".

## Setup

1. `docker compose up -d --wait`, then
   `pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed`.
2. `pnpm --filter @taxi/api dev` — the api on 3001 with `StubSmsProvider` bound
   (no `TWILIO_*` set). **The OTP is logged in full** by `auth.otp.stub_sent`;
   that is how you read a code.
3. Set `EXPO_PUBLIC_API_URL` to a host the device can reach —
   `http://10.0.2.2:3001` on an Android emulator, **not** `localhost`.
4. On the emulator: Extended Controls → Location → set a Rīga coordinate
   (the default is Google HQ, which reverse-geocodes to California).
5. Settings → Accessibility → **TalkBack on**. iOS: Settings → Accessibility →
   **VoiceOver on**.
6. `pnpm --filter @taxi/rider dev` and launch.
7. No seed rider row is needed — `SIGNUP_ROLES` includes `'rider'`, so signup is
   self-service.

## Steps

Each step names the gesture, what should be spoken, and the pass condition.

### 1 — Sign in

- **Gesture:** launch the app. Swipe right from the top.
- **Expect to hear:** "Pieslēgšanās, virsraksts" **first** — focus starts on the
  heading, not wherever the reader's cursor happened to be.
- **Do:** type `+37120000001` into the phone field, activate "Sūtīt kodu".
- **Expect:** the verify screen announces "Apstiprinājuma kods, virsraksts", and
  the code field has focus.
- **Do:** read the code from the api log, type it.
- **Pass:** the app lands on the booking screen without a further gesture — the
  sixth digit auto-submits.

### 2 — Booking screen orientation

- **Gesture:** swipe right repeatedly from the top.
- **Expect to hear, in order:** "Kurp dosimies?, virsraksts" → the pickup row →
  the dropoff row → (saved places, if any) → the payment radios → "Pasūtīt".
- **Pass:** the pickup row speaks a **street line**, not coordinates, and not
  "unlabelled". Nothing announces as a map, an image or a pin.

### 3 — Enter a destination

- **Gesture:** activate the dropoff row.
- **Expect:** "Galamērķis, virsraksts", then focus in the address field.
- **Do:** type `Brīvības`.
- **Expect to hear:** "Meklē…" from the live region, then the suggestion rows.
- **Pass:** each suggestion reads as **ONE** utterance —
  "Brīvības iela 45, Rīga, Latvija" — not as two separate stops. This is the
  single most-cited audio cost in the research (§1.2).

### 4 — Hear the price

- **Gesture:** activate a suggestion.
- **Expect:** the sheet closes, and the price is **announced without any further
  gesture** — "Cena €8.40".
- **Gesture:** swipe to the quote card.
- **Pass:** it reads as one utterance: total first, breakdown after —
  "Cena €8.40. Pamatlikme €2.00, attālums €5.40, laiks €1.00." Four numbers, one
  stop.

### 5 — Payment

- **Gesture:** swipe to the payment options.
- **Expect to hear:** "Skaidrā naudā, radio poga, atzīmēts" and
  "Ar karti, radio poga, nav atzīmēts".
- **Do:** activate "Ar karti".
- **Pass:** the selection is spoken as a state change, and **the price does not
  change** — cash and card are one identical fare.

### 6 — Book

- **Gesture:** activate "Pasūtīt".
- **Expect:** "Brauciens pieteikts" announced, then
  "Jūsu brauciens, virsraksts" with focus on it.
- **Pass:** the status line speaks "Meklējam auto…" without touching the screen.

### 7 — No drivers (the failure path)

- **Setup:** with no driver app online, book and wait.
- **Expect after 60 s:** "Vēl meklējam auto." — announced once.
- **Pass:** the app **never** says the search failed and never says "no drivers".
  `dispatch:unclaimed` goes to Dina's board, not to the rider, and the app has no
  basis for that claim.

### 8 — Matched

- **Setup:** with the driver app online nearby, book.
- **Expect:** "Brauciena statuss: Auto ir atrasts" announced with the phone in
  your pocket.
- **Pass:** you learn the car was found **without touching the screen**.

### 9 — Reconnect

- **Setup:** with a ride in `requested`, toggle airplane mode for 5 s, then off.
- **Expect:** "Atjaunojam savienojumu…" while down, and the status line recovers
  after — look for a `GET /rides/:rideId` in the api log.
- **Pass:** the screen recovers rather than freezing on a stale line.

### 10 — Permission refused

- **Setup:** reinstall; deny location at the prompt.
- **Expect:** the pickup row reads "Kurp?" and is activatable.
- **Pass:** a booking completes end to end with location permission denied
  outright. No blocking error anywhere.

### 11 — Two taps, measured

- **Setup:** save the dropoff from step 3 (type a label, activate
  "Saglabāt šo adresi"). Force-quit. Reopen.
- **Gesture:** activate the saved row, then "Pasūtīt".
- **Pass:** a booked ride in **two** activations. **Count them and record the
  number in `docs/ux-metrics-ledger.md`** — the ledger takes the measured
  figure, never the plan's.

### 12 — Android live regions (owed from PR #139)

`Banner.tsx`'s docblock states its Android live-region behaviour is `expected`,
never observed: it rests on the region firing for a freshly **mounted** view
rather than only for a content change. If that is wrong, Android has no
announcement at all.

- **Gesture:** on Android with TalkBack, trigger a banner (deny location, or
  force a quote failure by stopping the api).
- **Pass:** the banner text is spoken once — **not twice**, and not zero times.
- **Record the answer here**, and update `Banner.tsx`'s docblock either way. This
  closes PR #139 review finding F47.
