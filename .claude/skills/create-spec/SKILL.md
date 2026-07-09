---
name: create-spec
description: Generates the engineering spec (the "how") after the lean hypothesis PRD gate has passed. Use when the PRD hypothesis has been reviewed and it's time to pin down architecture, scope, phases, and contracts before the first PIV cycle. Writes docs/prd/01-spec.md.
argument-hint: [output-filename]
---

# Create Spec: Generate the Engineering Spec

## Overview

**Two-stage model (second-brain PRD canon):** the lean hypothesis PRD (`docs/prd/00-lean-prd.md`) is the *intent gate* — problem, hypothesis, non-goals. This skill produces the **spec** — the engineering decisions the PRD deliberately excludes. *"The PRD says we will not break old clients. The spec says how."* Run this only after the PRD has been reviewed with Atis and the hypothesis survives.

## Required Inputs — read these BEFORE writing anything

1. `docs/prd/00-lean-prd.md` — the gate. The spec must serve this hypothesis and respect its non-goals. **Do not duplicate** its problem/hypothesis/metrics sections — reference them.
2. `docs/prd/anketa-findings.md` — evidence + feature signals (commission band, dispatch model, phone channel, accessibility, pilot geography).
3. `docs/skeleton-proposal.md` — architecture and stack decisions already made; the spec formalizes, not re-litigates, these.
4. `CLAUDE.md` + `.claude/references/` (ride-state-machine, realtime-events, dispatch-strategies) — hard rules and existing contracts.

If any decision in the conversation contradicts these documents, stop and ask before writing.

## Output File

Write the spec to: `$ARGUMENTS` (default: `docs/prd/01-spec.md`)

## Spec Structure

Create a well-structured spec with the following sections. Adapt depth to available information:

**1. Executive Summary**
- What is being built for the demo/pilot, in 2-3 paragraphs
- One-line pointer to the PRD hypothesis this serves

**2. Scope**
- **In Scope:** core functionality (use ✅ checkboxes), grouped by surface (rider, driver, dispatch, admin, api, shared)
- **Out of Scope:** deferred features (use ❌ checkboxes) — must be a superset of the PRD's non-goals
- Every in-scope item traces to a PRD differentiator or an anketa feature signal (cite qids where useful)

**3. User Stories**
- 5-8 primary stories: "As a [user], I want to [action], so that [benefit]"
- Concrete examples for each; include dispatcher (Dina) and driver (Atis) stories, not just riders

**4. Core Architecture & Patterns**
- High-level architecture (monorepo surfaces, dispatch engine, realtime)
- Vertical Slice Architecture per app/service; slice list for phase 1
- Contract seam rules (`packages/shared`), state machine, provider seams

**5. Feature Specifications**
- Per-feature breakdown: behavior, edge cases, which slice owns it
- Dispatch strategies (auto-match, geozone queue, dispatcher override), pricing model, payment methods and the payment-lock rule

**6. Technology Stack**
- Technologies with versions (from skeleton-proposal + package.json — verify, don't recall)
- Third-party integrations behind seams (maps, SMS, payments)

**7. Data Model**
- Core entities, relationships, PostGIS usage
- Money = integer cents EUR; multi-city-ready keys

**8. API & Realtime Specification**
- REST endpoint definitions, request/response shapes (zod in `packages/shared`)
- Socket.IO event catalog (extend `.claude/references/realtime-events.md`, don't fork it)

**9. Security & Configuration**
- AuthN/AuthZ approach per surface
- Config management; anketa-derived numbers (commission %, guarantees) are **config, not constants**

**10. Success Criteria**
- Demo definition of done (the PRD's experiment #2: one ride end-to-end across all four surfaces + the three differentiators)
- Functional requirements (✅ checkboxes); `pnpm check` green is the floor, not the bar

**11. Implementation Phases**
- 3-4 phases; each with goal, deliverables (✅ checkboxes), validation criteria
- Each phase = a sequence of PIV cycles (plan-feature → execute → validate); name the slices

**12. Risks & Mitigations**
- Engineering risks only (product risks live in the PRD)

**13. Appendix**
- Links: PRD, anketa findings, skeleton proposal, references

## Instructions

1. **Extract requirements** from the input documents and conversation history; note constraints and preferences.
2. **Synthesize** — organize into sections, fill reasonable assumptions where details are missing, keep terminology consistent with `packages/shared` naming.
3. **Write** — clear, professional, concrete examples, markdown throughout (✅/❌ checkboxes, tables, code blocks for contracts).
4. **Quality check:**
   - ✅ All sections present; scope traces to PRD/anketa evidence
   - ✅ No duplication of PRD intent sections (problem, hypothesis, metrics)
   - ✅ Consistent with skeleton-proposal decisions and CLAUDE.md hard rules
   - ✅ Implementation phases are actionable as PIV cycles
   - ✅ Success criteria are measurable

## Output Confirmation

After creating the spec:
1. Confirm the file path
2. Brief summary of contents
3. Highlight assumptions made due to missing information
4. Suggest next steps (review with Atis → first `plan-feature` cycle)

## Notes

- If critical information is missing, ask clarifying questions before generating.
- Commission %, guarantee amounts, and the final feature cut come from the anketa/founder decisions — mark them as config inputs if still unsettled.
