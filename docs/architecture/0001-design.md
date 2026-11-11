# 0001: Docs design record

Status: **built** (2026-11-10), 0.1.0. The security read's changes are in docs/decisions.md. Task K282, P3. Built from the owner's decisions of 2026-11-09 in captive-origins `docs/feature-docs-proposal.md`, which this record follows except where it says otherwise.

## The owner's decisions (2026-11-09)

- **Its own plugin.**
- **Generated from Features:** /docs and its sub-pages for everything in Features, at the right level and in proper detail.
- **Hand-written extra pages** sit beside them.
- **/docs always contains at least everything in Features.**
- **Reviews:** Claude reviews the pages, and the owner spot-checks.
- **Planned features** get a short page marked Planned.
- **Timing:** built after tour v3.

Name approved 2026-11-10: **Docs**, `@captiveorigins/payload-plugin-docs`. MIT. Public from its first push (D5); this replaces "private until the owner's yes" in the proposal.

## What changes from the proposal: features through an adapter (D2)

The proposal had Docs "extend the features plugin" (the roadmap plugin's catalog). Under D2, plugins don't depend on each other, so Docs reads features through a **source** adapter that any plugin or site can give:

```ts
type FeatureSource = {
  name: string
  /** Every feature, with what a page needs. */
  list: (args: { req }) => Promise<Feature[]>
  /** Tells Docs when a feature changes, so its page follows. The source calls `onFeatureChange` from its own hook. */
}
type Feature = { id: string; section: { key: string; title: string }; title: string; summary?: string; details?: string; stage: 'available' | 'members' | 'in-progress' | 'planned'; audience?: string; links?: string[]; notesForDocs?: string; version: string }
```

- **The roadmap plugin** gets an optional adapter in its own repo, registered at `config.custom.docs.sources`, with no import either way. A site without the roadmap plugin passes its own `list`.
- **Docs exports `onFeatureChange(payload, feature, req)`.** A source calls it from its hook when a feature is created, edited or removed. Docs also re-reads every source in the nightly check, so a missed hook is found.

## What it adds

- **A `docs-pages` collection, as in the proposal:**
  - kind (`feature` or `extra`), feature id, source, section, title, summary, body (rich text), order;
  - drafts and versions;
  - `generatedFrom` (the feature's version), `outOfDate`;
  - `review` (by, on, and a hash of the body), `archived`.
- **A feature always has a page:**
  - a new feature gets a generated draft;
  - changed wording marks the page out of date, with a fresh draft beside it;
  - a removed feature's page is archived, never deleted.
- **Generation goes through the site's own function** (`generate({ feature, uiText })`). The site makes the model call, so on Captive Origins it runs through AI Budget's `withAiBudget` (job `docs`). Docs never calls an AI itself and never reads source code, config or the schema.
- **The security lint** refuses publishing a page that holds env-var names, file paths, collection or field slugs, internal hosts, IP addresses, key-like strings, or the site's private terms. It has an allow-list for public names.
- **Review rules:** a page can't publish unreviewed, and editing the body clears the review.
- **`checkDocs(payload)`**, for the nightly job and the pre-release step, fails on:
  - a feature with no page;
  - an out-of-date page;
  - a released feature that isn't published;
  - a broken internal link;
  - a lint hit.
  It returns the list, and the site's job decides how to fail.
- **Rendering stays the site's** (its own `/docs` routes). Docs gives `docsTree(payload, { locale })` (sections, then features and extras) and `docsPage(payload, path)`.

## Access

- Published pages are public.
- Drafts, reviews and the out-of-date flags are for editors (`access.edit`, required).
- Only reviewers set a review (`access.review`, required).

## Seed World (D8)

A new `docs-pages` collection. For the tour: a few sections, with one page each for available, members, in-progress and planned, plus one extra page.

## Tests (planned)

- The hook: made, out of date, archived. The nightly check also finds a feature with no page.
- "At least everything in Features", across two sources.
- The lint: each kind of leak, the allow-list, and the publish refusal.
- Review: unreviewed can't publish; editing clears the review.
- The check: each failure.
- Access: public sees published pages only; editors see the rest; reviewers review.
- The generator is the site's: Docs passes no source code. Its input is the feature fields and the UI text only.

## Rough time

About 3 session days for the plugin, as in the proposal. The site's routes and the 74 pages are the Site lead's, with Claude's review and the owner's spot-check.
