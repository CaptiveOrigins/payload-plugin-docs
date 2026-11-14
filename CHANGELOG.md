# Changelog

## 0.1.0 (unreleased)

First version, from the owner's 2026-11-09 decisions (the site's feature docs proposal), with features read through source adapters (D2): pages kept in step with features, archived not deleted, drafts from the site's generator, the publish-time lint, reviews that hold only for the words reviewed, `checkDocs`, `docsTree` and `docsPage`.

After the security read of 8250b10: drafts for editors only, explicit approval, every feature's page published, many extra pages, an out-of-date flag that clears, archived pages hidden from draft reads, the section and path reviewed and linted, sources that fail or come back empty reported, failed drafts retried, the generator given only feature fields, and a lint that reads through escaping.

Tested: 20 integration tests with a fake generator. Not tested: a real site, a real model call.
