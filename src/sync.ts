import type { CollectionSlug, Payload, Where } from 'payload'

import { SYNC } from './collection.js'
import { lint, textOf } from './lint.js'
import type { Feature, Req } from './types.js'
import { configOf, slugOf } from './util.js'

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const sys = { overrideAccess: true, depth: 0 } as const
const ctx = { [SYNC]: true }

const PLANNED = (f: Feature) => `**Planned.** This is what we intend to build. There's nothing to use yet.\n\n${f.summary ?? ''}`.trim()

async function pageFor(payload: Payload, source: string, featureId: string): Promise<Doc | null> {
  const o = configOf(payload)
  const where: Where = { and: [{ source: { equals: source } }, { featureId: { equals: featureId } }] }
  return ((await payload.find({ collection: o.slug as CollectionSlug, where, limit: 1, pagination: false, draft: false, ...sys })).docs as Doc[])[0] ?? null
}

/** The words for a page: the site's generator when there is one, else the feature's own summary. Never throws. */
async function words(payload: Payload, f: Feature, req?: Req): Promise<{ summary: string; body: string; ok: boolean }> {
  const o = configOf(payload)
  if (f.stage === 'planned') return { summary: f.summary ?? '', body: PLANNED(f), ok: true }
  if (!o.generate) return { summary: f.summary ?? '', body: [f.summary, f.details].filter(Boolean).join('\n\n'), ok: true }
  try {
    const uiText = await o.uiTextFor?.(f, { payload })
    const out = await o.generate({ feature: f, uiText, payload, req })
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
      if (page && !page.archived) await payload.db.updateOne({ collection: o.slug, where: { id: { equals: page.id } }, data: { archived: true } } as never)
      return 'archived'
    }
    const f = args.feature
    const base = { kind: 'feature', source: args.source, featureId: String(f.id), sectionKey: f.section.key, section: f.section.title, title: f.title, stage: f.stage, generatedFrom: f.version }
    if (!page) {
      const w = await words(payload, f, args.req)
      await payload.create({ collection: o.slug as CollectionSlug, data: { ...base, slug: slugOf(f.title), summary: w.summary, body: w.body, outOfDate: !w.ok, archived: false, _status: 'draft' } as never, draft: true, ...sys, context: ctx })
      return 'made'
    }
    if (page.generatedFrom === f.version && !page.archived) return 'same'
    const w = await words(payload, f, args.req)
    // The live page keeps its words; it's flagged, and the fresh draft waits for review.
    await payload.db.updateOne({ collection: o.slug, where: { id: { equals: page.id } }, data: { outOfDate: true, archived: false } } as never)
    await payload.update({ collection: o.slug as CollectionSlug, id: page.id, data: { ...base, summary: w.summary, body: w.body, outOfDate: true, archived: false, _status: 'draft' } as never, draft: true, ...sys, context: ctx })
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
  for (const source of o.sources) {
    const features = await source.list({ payload, req })
    const ids = new Set(features.map((f) => String(f.id)))
    for (const f of features) tally[await onFeatureChange(payload, { source: source.name, feature: f, req })]++
    const pages = (await payload.find({ collection: o.slug as CollectionSlug, where: { and: [{ source: { equals: source.name } }, { archived: { not_equals: true } }] }, pagination: false, draft: false, ...sys })).docs as Doc[]
    for (const p of pages) if (!ids.has(String(p.featureId))) tally[await onFeatureChange(payload, { source: source.name, removedId: String(p.featureId), req })]++
  }
  return tally
}

export type DocsProblem = { kind: 'missing' | 'outOfDate' | 'unpublished' | 'brokenLink' | 'lint'; ref: string; detail?: string }

/**
 * Everything wrong, for the nightly job and the pre-release step. It doesn't fix anything: it reports.
 * - every feature from every source has a page (so /docs is never smaller than Features);
 * - no page is out of date;
 * - every available or members feature's page is published;
 * - every /docs link on a published page resolves;
 * - no published page trips the lint.
 */
export async function checkDocs(payload: Payload, req?: Req): Promise<{ ok: boolean; problems: DocsProblem[] }> {
  const o = configOf(payload)
  const problems: DocsProblem[] = []
  const all = (await payload.find({ collection: o.slug as CollectionSlug, pagination: false, draft: false, ...sys })).docs as Doc[]
  const live = all.filter((p) => p._status === 'published' && !p.archived)
  for (const source of o.sources) {
    for (const f of await source.list({ payload, req })) {
      const page = all.find((p) => p.source === source.name && String(p.featureId) === String(f.id))
      if (!page || page.archived) problems.push({ kind: 'missing', ref: `${source.name}:${f.id}` })
      else {
        if (page.outOfDate || page.generatedFrom !== f.version) problems.push({ kind: 'outOfDate', ref: `${source.name}:${f.id}` })
        if ((f.stage === 'available' || f.stage === 'members') && page._status !== 'published') problems.push({ kind: 'unpublished', ref: `${source.name}:${f.id}` })
      }
    }
  }
  const paths = new Set(live.map((p) => `${o.basePath}/${p.sectionKey}/${p.slug}`))
  const sections = new Set(live.map((p) => `${o.basePath}/${p.sectionKey}`))
  for (const p of live) {
    const text = `${p.title ?? ''}\n${p.summary ?? ''}\n${textOf(p.body)}`
    for (const h of lint(o, text)) problems.push({ kind: 'lint', ref: String(p.id), detail: h.kind })
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
