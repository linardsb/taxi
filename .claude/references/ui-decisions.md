# UI decisions — deferred cosmetic questions

Cosmetic questions raised mid-feature are logged here instead of debated, and resolved in the brand-identity epic.
Format: one line per question — `YYYY-MM-DD · surface · question`.

2026-08-31 · driver · «Šodien: €84.20 · Braucieni: 7» label form vs «7 braucieni» — sidesteps LV plural forms; revisit with the brand copy pass.
2026-08-31 · driver · money format «€84.20» (symbol first, dot decimal, `formatEur`) vs the Latvian «84,20 €» — the brand copy pass decides.
2026-08-31 · driver · the vehicle `category` picker — pilot is `standard` only, so the field is hidden and fixed; surface it when a second category is sold.
2026-08-31 · driver · border widths 1 px / 2 px (Button, TextField, Banner, chips) are not theme tokens — add `borderWidth` to the theme or accept the literals.
2026-08-31 · driver · focus ring: a 2 px `colors.fg` outline, offset 2 px, on every pressable (Button, language chips) — the accent-coloured border vanished on the accent-filled primary and reflowed it on focus; the brand epic picks the final ring colour and whether it becomes a theme token.
