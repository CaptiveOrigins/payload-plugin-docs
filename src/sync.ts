import type { CollectionSlug, Payload, Where } from 'payload'

import { pageText } from './collection.js'
import { lint } from './lint.js'
import type { Feature, FeatureSource, Req } from './types.js'
import { configOf, slugOf } from './util.js'

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const sys = { overrideAccess: true, depth: 0 } as const

const PLANNED = (f: Feature) => `**Planned.** This is what we intend to build. There's nothing to use yet.\n\n${f.summary ?? ''}`.trim()

async function pageFor(payload: Payload, source: string, featureId: string): Promise<Doc | null> {
  const o = configOf(payload)
  const where: Where = { and: [{ source: { equals: source } }, { featureId: { equals: featureId } }] }
  // The latest version, draft or not: a fresh draft's version mark is what tells the next sync whether to try again.
  return ((await payload.find({ collection: o.slug as CollectionSlug, where, limit: 1, pagination: false, draft: true, ...sys })).docs as Doc[])[0] ?? null
}

/** Every source: the plugin's own and those other plugins registered at `config.custom.docsSources`. Names are unique. */
export function sourcesOf(payload: Payload): FeatureSource[] {
  const o = configOf(payload)
  const extra = (payload.config.custom?.docsSources ?? []) as FeatureSource[]
  const all = [...o.sources, ...(Array.isArray(extra) ? extra : [])]
  const names = all.map((x) => x.name)
  if (new Set(names).size !== names.length) throw new Error('Docs: two feature sources have the same name.')
  return all
}

/** A slug not yet used in this section, and not one of the site's collection names: `name`, `name-2`, `name-page`. */
async function freeSlug(payload: Payload, sectionKey: string, slug: string): Promise<string> {
  const o = configOf(payload)
  // A slug that matches one of the site's collection names would be refused by the lint: give it a suffix.
  if (o.slugs.some((s) => s.toLowerCase() === slug.toLowerCase())) slug = `${slug}-page`
  const taken = new Set(((await payload.find({ collection: o.slug as CollectionSlug, where: { sectionKey: { equals: sectionKey } }, pagination: false, draft: false, select: { slug: true } as never, ...sys })).docs as Doc[]).map((d) => d.slug))
  if (!taken.has(slug)) return slug
  for (let i = 2; ; i++) if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}`
}

/** The words for a page: the site's generator when there is one, else the feature's own summary. Never throws. */
async function words(payload: Payload, f: Feature, req?: Req): Promise<{ summary: string; body: string; ok: boolean }> {
  const o = configOf(payload)
  if (f.stage === 'planned') return { summary: f.summary ?? '', body: PLANNED(f), ok: true }
  if (!o.generate) return { summary: f.summary ?? '', body: [f.summary, f.details].filter(Boolean).join('\n\n'), ok: true }
  try {
    // Only the feature's own known fields reach the generator, whatever else a source returns.
    const feature: Feature = { id: f.id, section: { key: f.section.key, title: f.section.title }, title: f.title, summary: f.summary, details: f.details, stage: f.stage, audience: f.audience, links: f.links, notesForDocs: f.notesForDocs, version: f.version }
    const uiText = await o.uiTextFor?.(feature, { payload })
    const out = await o.generate({ feature, uiText, payload, req })
    return { summary: String(out.summary ?? ''), body: String(out.body ?? ''), ok: true }
  } catch (error) {
    payload.logger.error({ err: { name: (error as Error)?.name }, feature: f.id, msg: 'docs: a page draft could not be generated; the page is marked out of date' })
    return { summary: f.summary ?? '', body: f.summary ?? '', ok: false }
  }
}

/**
 * Keeps one feature's page in step. A new feature gets a draft page. Changed words mark the page out of date and
 * put a fresh draft beside it, while the published words stay until a reviewer publishes the new ones. A removed
 * feature's page is archived, never deleted. A source calls this from its own hook; never throws.
 */
export async function onFeatureChange(payload: Payload, args: { source: string; feature?: Feature; removedId?: string; req?: Req }): Promise<'made' | 'outOfDate' | 'same' | 'archived' | 'error'> {
  const o = configOf(payload)
  try {
    const id = args.feature?.id ?? args.removedId
    if (!id) return 'error'
    const page = await pageFor(payload, args.source, String(id))
    if (!args.feature) {
      if (page && !page.archived) {
        // On the live page and as its latest version, so no read (published or draft) shows it to the public.
        await payload.db.updateOne({ collection: o.slug, where: { id: { equals: page.id } }, data: { archived: true } } as never)
        await payload.update({ collection: o.slug as CollectionSlug, id: page.id, data: { archived: true, _status: 'draft' } as never, draft: true, ...sys })
      }
      return 'archived'
    }
    const f = args.feature
    const base = { kind: 'feature', source: args.source, featureId: String(f.id), sectionKey: f.section.key, section: f.section.title, title: f.title, stage: f.stage }
    if (!page) {
      const w = await words(payload, f, args.req)
      // A failed draft keeps no version mark, so the next sync tries again.
      await payload.create({ collection: o.slug as CollectionSlug, data: { ...base, generatedFrom: w.ok ? f.version : null, slug: await freeSlug(payload, f.section.key, slugOf(f.title)), summary: w.summary, body: w.body, outOfDate: !w.ok, archived: false, _status: 'draft' } as never, draft: true, ...sys })
      return 'made'
    }
    if (page.generatedFrom === f.version && !page.archived) return 'same'
    const w = await words(payload, f, args.req)
    // The live page keeps its words; it's flagged, and the fresh draft waits for review.
    await payload.db.updateOne({ collection: o.slug, where: { id: { equals: page.id } }, data: { outOfDate: true, archived: false } } as never)
    await payload.update({ collection: o.slug as CollectionSlug, id: page.id, data: { ...base, generatedFrom: w.ok ? f.version : null, summary: w.summary, body: w.body, outOfDate: true, archived: false, _status: 'draft' } as never, draft: true, ...sys })
    return 'outOfDate'
  } catch (error) {
    payload.logger.error({ err: { name: (error as Error)?.name }, msg: 'docs: a feature change was not applied to its page' })
    return 'error'
  }
}

/** Reads every source and brings every page in step: pages made, flagged or archived. For the nightly job. */
export async function syncDocs(payload: Payload, req?: Req) {
  const o = configOf(payload)
  const tally = { made: 0, outOfDate: 0, same: 0, archived: 0, error: 0 }
  const failed: string[] = []
  for (const source of sourcesOf(payload)) {
    let features: Feature[]
    try {
      features = await source.list({ payload, req })
    } catch (error) {
      payload.logger.error({ err: { name: (error as Error)?.name }, source: source.name, msg: 'docs: a feature source failed; its pages were left as they are' })
      failed.push(source.name)
      continue
    }
    // An empty list from a source that had features is more likely a fault than every feature going at once.
    if (!features.length) {
      payload.logger.warn({ source: source.name, msg: 'docs: a feature source returned nothing; its pages were left as they are' })
      continue
    }
    const ids = new Set(features.map((f) => String(f.id)))
    for (const f of features) tally[await onFeatureChange(payload, { source: source.name, feature: f, req })]++
    const pages = (await payload.find({ collection: o.slug as CollectionSlug, where: { and: [{ source: { equals: source.name } }, { archived: { not_equals: true } }] }, pagination: false, draft: false, ...sys })).docs as Doc[]
    for (const p of pages) if (!ids.has(String(p.featureId))) tally[await onFeatureChange(payload, { source: source.name, removedId: String(p.featureId), req })]++
  }
  return { ...tally, failedSources: failed }
}

export type DocsProblem = { kind: 'missing' | 'outOfDate' | 'unpublished' | 'brokenLink' | 'lint' | 'duplicate' | 'sourceFailed' | 'emptySource'; ref: string; detail?: string }

/**
 * Everything wrong, for the nightly job and the pre-release step. It doesn't fix anything: it reports.
 * - every feature from every source has a page (so /docs is never smaller than Features);
 * - no page is out of date;
 * - every feature's page is published, planned ones included (the owner: /docs always holds at least everything in Features);
 * - no feature has two pages, and no two pages share a path;
 * - every source answered, with something;
 * - every /docs link on a published page resolves;
 * - no published page trips the lint.
 */
export async function checkDocs(payload: Payload, req?: Req): Promise<{ ok: boolean; problems: DocsProblem[] }> {
  const o = configOf(payload)
  const problems: DocsProblem[] = []
  const all = (await payload.find({ collection: o.slug as CollectionSlug, pagination: false, draft: false, ...sys })).docs as Doc[]
  const live = all.filter((p) => p._status === 'published' && !p.archived)
  for (const source of sourcesOf(payload)) {
    let features: Feature[]
    try {
      features = await source.list({ payload, req })
    } catch {
      problems.push({ kind: 'sourceFailed', ref: source.name })
      continue
    }
    // Nothing from a source that has pages looks like a fault, not every feature going at once.
    if (!features.length && all.some((p) => p.source === source.name && !p.archived)) problems.push({ kind: 'emptySource', ref: source.name })
    for (const f of features) {
      const pagesOf = all.filter((p) => p.source === source.name && String(p.featureId) === String(f.id) && !p.archived)
      const page = pagesOf[0]
      if (pagesOf.length > 1) problems.push({ kind: 'duplicate', ref: `${source.name}:${f.id}` })
      if (!page) problems.push({ kind: 'missing', ref: `${source.name}:${f.id}` })
      else {
        if (page.outOfDate || page.generatedFrom !== f.version) problems.push({ kind: 'outOfDate', ref: `${source.name}:${f.id}` })
        if (page._status !== 'published') problems.push({ kind: 'unpublished', ref: `${source.name}:${f.id}` })
      }
    }
  }
  const seen = new Map<string, string>()
  for (const p of all.filter((x) => !x.archived)) {
    const path = `${p.sectionKey}/${p.slug}`
    if (seen.has(path)) problems.push({ kind: 'duplicate', ref: String(p.id), detail: `${o.basePath}/${path}` })
    else seen.set(path, String(p.id))
  }
  const paths = new Set(live.map((p) => `${o.basePath}/${p.sectionKey}/${p.slug}`))
  const sections = new Set(live.map((p) => `${o.basePath}/${p.sectionKey}`))
  for (const p of live) {
    for (const h of lint(o, pageText(p))) problems.push({ kind: 'lint', ref: String(p.id), detail: h.kind })
    for (const m of String(p.body ?? '').matchAll(/\]\((\/[^)\s#?]*)/g)) {
      const link = m[1]!.replace(/\/$/, '')
      if (link.startsWith(o.basePath) && link !== o.basePath && !paths.has(link) && !sections.has(link)) problems.push({ kind: 'brokenLink', ref: String(p.id), detail: link })
    }
  }
  return { ok: problems.length === 0, problems }
}

/** The published tree for the site's /docs routes: sections, each with its pages in order. */
export async function docsTree(payload: Payload, args: { locale?: string } = {}) {
  const o = configOf(payload)
  const pages = (await payload.find({ collection: o.slug as CollectionSlug, where: { and: [{ _status: { equals: 'published' } }, { archived: { not_equals: true } }] }, sort: ['sectionKey', 'order', 'title'], pagination: false, ...sys, ...(args.locale ? { locale: args.locale as never } : {}) })).docs as Doc[]
  const sections = new Map<string, { key: string; title: string; pages: { title: string; summary: string; path: string; stage: string | null; kind: string }[] }>()
  for (const p of pages) {
    const s = sections.get(p.sectionKey) ?? { key: String(p.sectionKey), title: String(p.section), pages: [] as { title: string; summary: string; path: string; stage: string | null; kind: string }[] }
    s.pages.push({ title: p.title, summary: p.summary ?? '', path: `${o.basePath}/${p.sectionKey}/${p.slug}`, stage: p.stage ?? null, kind: p.kind })
    sections.set(p.sectionKey, s)
  }
  return [...sections.values()]
}

/** One published page by its path, or null. */
export async function docsPage(payload: Payload, path: string) {
  const o = configOf(payload)
  const [section, slug] = path.replace(new RegExp(`^${o.basePath}/?`), '').split('/')
  if (!section || !slug) return null
  return (((await payload.find({ collection: o.slug as CollectionSlug, where: { and: [{ sectionKey: { equals: section } }, { slug: { equals: slug } }, { _status: { equals: 'published' } }, { archived: { not_equals: true } }] }, limit: 1, pagination: false, ...sys })).docs as Doc[])[0] ?? null)
}
