import type { Access, Config, Plugin } from 'payload'

import { docsCollection } from './collection.js'
import type { DocsOptions, FeatureSource, Resolved } from './types.js'

/**
 * Docs: a page for every feature, kept in step by the source's hook and a nightly sync, with hand-written pages
 * beside them; a lint that refuses publishing internals; reviews that hold only for the words reviewed; and a check
 * that nothing is missing. Feature sources and the generator are adapters; Docs depends on no other plugin.
 */
export const docsPlugin =
  (options: DocsOptions): Plugin =>
  (config: Config): Config => {
    const fromConfig = ((config.custom?.docs as { sources?: FeatureSource[] } | undefined)?.sources ?? []) as FeatureSource[]
    const o: Resolved = {
      slug: options.collectionSlug ?? 'docs-pages',
      sources: [...(options.sources ?? []), ...fromConfig],
      generate: options.generate,
      uiTextFor: options.uiTextFor,
      edit: options?.access?.edit as Access,
      review: options?.access?.review as Access,
      privateTerms: (options.privateTerms ?? []).filter((t) => typeof t === 'string' && t.trim()),
      allow: options.allow ?? [],
      slugs: options.slugs ?? (config.collections ?? []).map((c) => c.slug),
      basePath: (options.basePath ?? '/docs').replace(/\/$/, ''),
      adminGroup: options.adminGroup ?? 'Docs',
    }
    if (typeof o.edit !== 'function' || typeof o.review !== 'function') throw new Error('Docs: give `access.edit` and `access.review`.')
    const names = o.sources.map((s) => s.name)
    if (new Set(names).size !== names.length) throw new Error('Docs: two feature sources have the same name.')
    return {
      ...config,
      custom: { ...config.custom, docs: o },
      collections: [...(config.collections ?? []), docsCollection(o)],
    }
  }
