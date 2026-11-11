# payload-plugin-docs

Docs for Payload: a docs page for every feature your site lists, made and kept up to date by hook, with hand-written pages beside them, a publish-time lint for internals, and a check that nothing is missing.

**Status:** 0.1.0, not on npm yet. 20 tests pass against Payload 3.92 with an in-memory MongoDB replica set and a fake generator (no AI is called). They cover pages following features, the lint, reviews, publishing rules, public access, the check and the tree. No site uses it yet.

## What it does

- **Sources that fail or come back empty** leave their pages alone, and the check reports them. A failed draft is tried again at the next sync.
- **A page for every feature.** Features come from one or more sources: a few lines each, from a roadmap plugin's catalog or your own list.
  - A source calls `onFeatureChange` from its own hook. `syncDocs(payload)`, nightly, reads every source and catches anything a hook missed.
  - A new feature gets a draft page.
  - When a feature's words change, its page is marked out of date. A fresh draft waits beside the published words until it's reviewed and published.
  - A removed feature's page is archived, never deleted. Nobody can delete a page.
  - A planned feature gets a short page that starts "**Planned.** This is what we intend to build. There's nothing to use yet."
- **Drafts come from your generator** (`generate`), given the feature's own fields and, if you give `uiTextFor`, the user-facing text of its pages.
  - Docs never reads source code, config or the schema, and never calls an AI itself.
  - If the generator fails, the page is still made and marked out of date.
  - Without a generator, the feature's summary and details are used.
- **Hand-written pages** (`kind: 'extra'`) sit in the same sections.
- **Nothing internal goes public.** Publishing is refused if a page's title, summary or body has any of these:
  - environment variable names or file paths;
  - IP addresses or internal hosts;
  - key-like strings;
  - your collection names written like code;
  - your private terms.

  `allow` lets public names through (YouTube, Stripe).
- **Reviews:**
  - Only reviewers (`access.review`) review, and a page is approved only when the reviewer ticks `approved`. A note alone approves nothing.
  - An approval holds only for the words it saw: the section, path, title, summary and body. Editing any of them clears it.
  - Publishing an approved page clears its out-of-date flag.
  - A page can't be published unreviewed, so editing a published page's words means a draft and a new review.
- **`checkDocs(payload)`**, for a nightly job and your pre-release step, lists:
  - features with no page;
  - out-of-date pages;
  - features whose page isn't published, planned ones included, so /docs always holds at least everything in Features;
  - two pages for one feature, or two pages on one path;
  - a source that failed, or returned nothing while it has pages;
  - `/docs` links that go nowhere;
  - lint hits on published pages.

- **Reading:**
  - `docsTree(payload)` gives the published sections and pages, for your `/docs` routes.
  - `docsPage(payload, '/docs/section/slug')` gives one page.
  - The public sees only published pages that aren't archived, without review details or the plugin's own fields. Drafts and old versions are for editors (`access.edit`) only.
- **Bodies are Markdown**, so your site renders them its own way.

## Install

```sh
npm install @captiveorigins/payload-plugin-docs
```

```ts
import { docsPlugin, onFeatureChange } from '@captiveorigins/payload-plugin-docs'

docsPlugin({
  sources: [{ name: 'catalog', list: async ({ payload }) => myFeatures(payload) }],
  generate: async ({ feature, uiText }) => myModelCall(feature, uiText), // { summary, body } in Markdown
  access: { edit: isEditor, review: isReviewer }, // both required
  privateTerms: myPrivateTerms,
  allow: ['YouTube', 'Stripe'],
})

// In your feature source's own hook:
await onFeatureChange(payload, { source: 'catalog', feature, req }) // or { source, removedId, req }
```

Run `syncDocs` and `checkDocs` nightly. A feature source can also register itself at `config.custom.docs.sources`, with no import.

## Limits

- The lint is a pattern check, not an understanding. It catches the common ways internals leak. A person still reviews every page before it's published.
- Collection names are refused when they look like code (with a hyphen or underscore, mixed case, or in backticks), so ordinary words that happen to be a collection's name don't trip it.
- MongoDB only for now.

## Commands

```sh
npm test          # integration tests, in-memory MongoDB
npm run typecheck
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
