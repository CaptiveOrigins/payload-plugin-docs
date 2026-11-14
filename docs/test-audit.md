# Test audit

Newest first.

## 2026-11-10: 0.1.0

| Promise | Test |
| --- | --- |
| A new feature gets a draft from its fields; planned gets a Planned page, not generated | `a page for every feature > makes a draft…` |
| A changed feature marks the page out of date; the published words stay; a fresh draft waits | `a page for every feature > marks a page out of date…` |
| A removed feature's page is archived; nobody deletes pages | `a page for every feature > archives…` |
| A failing generator never throws: the page is made, out of date | `a page for every feature > never throws…` |
| Every source synced; removed features archived | `a page for every feature > syncs every source…` |
| The lint finds each kind of internal, and lets allowed names through | `the lint, reviews and publishing > finds internals…` |
| Unreviewed, edited-after-review and internal pages can't publish; only reviewers review | `the lint, reviews and publishing > refuses to publish…` |
| The public sees published, unarchived pages only, without review details | `the lint, reviews and publishing > shows the public…` |
| The check finds missing, out-of-date, unpublished, broken links and lint hits; passes when clean | `the check > reports…` |
| The tree and a page by path | `the check > gives the site a tree…` |

Mutation check: 14 guards, all caught (two after tests were added: a stale review is cleared, and an archived page counts as missing).

## 2026-11-10: after the security read of 8250b10

Ten tests added in `what the security read found`:
- drafts and versions for editors only;
- approval needs `approved: true`, and the plugin stamps the hash;
- many extra pages, and distinct paths for same-titled features;
- out-of-date cleared on approval, so the check goes green;
- archived pages hidden from draft reads;
- section and path linted and reviewed, and internal fields hidden;
- failing and empty sources leave pages alone and are reported;
- a failed draft is retried, and the generator gets only the feature's fields;
- the lint sees through escaping (Markdown, entities, comments, invisible characters, look-alike hyphens);
- rich-text links, the allow-list and members pages.

Mutation check: 17 guards; all caught but two that cover each other. Approval needs both the `approved` tick and a hash the plugin stamps only when it's ticked, so dropping either check alone is caught by the other. That's kept as two layers.
