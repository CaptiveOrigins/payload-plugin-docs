# Decisions

Dated decisions for this repo, newest last.

- 2026-11-10: created from the ops starter kit, area `co-plugins`.

- 2026-11-10: the Plugins Lead leads this repo (D23; task K282, P3). Name approved 2026-11-10. MIT, public from its first push (D5), which replaces "private until the owner's yes" in the site's feature docs proposal. The owner's decisions of 2026-11-09 there stand. Design in [architecture/0001-design.md](architecture/0001-design.md).
- 2026-11-10 (D2): Docs reads features through a source adapter instead of extending the roadmap plugin, so neither depends on the other. Generation goes through the site's own function (on the first site, inside AI Budget).

- 2026-11-10 (security read of 8250b10): every feature's page must be published, planned and in-progress ones included, to keep the owner's rule that /docs always holds at least everything in Features. Approval needs an explicit `approved` tick, and the plugin stamps the hash of the words approved. Drafts and versions are for editors only.
- 2026-11-13: moved to the ExtantApe GitHub organization and the `@extantape` npm scope at the same version. EXTANT APE owns its reusable tools and licenses them to the platform. The earlier package name is deprecated with a pointer here, and GitHub redirects the old repository address.
