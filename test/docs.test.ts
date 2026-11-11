import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { checkDocs, docsPage, docsPlugin, docsTree, lint, onFeatureChange, syncDocs, textOf, type Feature } from '../src/index.js'

// A made-up site with two feature sources and a fake generator. No AI is called.
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let mongo: MongoMemoryReplSet
let features: Feature[] = []
let others: Feature[] = []
let generateThrows = false
let sourceThrows = false
const generated: Doc[] = []

const f = (id: string, extra: Partial<Feature> = {}): Feature => ({ id, section: { key: 'animals', title: 'Animals' }, title: `Feature ${id}`, summary: `What ${id} does`, stage: 'available', version: 'v1', ...extra })
const pages = async () => (await payload.find({ collection: 'docs-pages' as never, pagination: false, draft: false, depth: 0, overrideAccess: true })).docs as Doc[]
const page = async (id: string, source = 'catalog') => (await pages()).find((p) => p.featureId === id && p.source === source)!
const editor = { id: 'e1', role: 'editor', collection: 'users' }
const reviewer = { id: 'r1', role: 'reviewer', collection: 'users' }
const as = (user: Doc | null) => ({ overrideAccess: false, user: user as never })
/** Review a page as it stands, then publish it. */
const reviewAndPublish = async (id: string | number) => {
  await payload.update({ collection: 'docs-pages' as never, id, data: { review: { approved: true, by: 'r1', notes: 'ok' } } as never, ...as(reviewer) })
  return payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('docs'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }] },
        { slug: 'animal-records', fields: [{ name: 'name', type: 'text' }] },
      ],
      plugins: [
        docsPlugin({
          sources: [
            { name: 'catalog', list: async () => { if (sourceThrows) throw new Error('made-up outage'); return features } },
            { name: 'extras-source', list: async () => others },
          ],
          generate: async ({ feature }) => {
            if (generateThrows) throw new Error('made-up model outage')
            generated.push({ id: feature.id, keys: Object.keys(feature) })
            return { summary: `About ${feature.title}`, body: `How to use ${feature.title}, step by step.` }
          },
          access: {
            edit: ({ req }) => ['editor', 'reviewer'].includes(String((req.user as { role?: string } | null)?.role)),
            review: ({ req }) => (req.user as { role?: string } | null)?.role === 'reviewer',
          },
          privateTerms: ['secret-project-name'],
          allow: ['YouTube'],
        }),
      ],
    }),
  })
  const models = (payload.db as unknown as { collections: Record<string, { createCollection: () => Promise<unknown>; ensureIndexes: () => Promise<unknown>; collection: { deleteMany: (q: object) => Promise<unknown> } }> }).collections
  for (const m of Object.values(models)) await m.createCollection().catch(() => undefined)
  for (const m of Object.values(models)) await m.ensureIndexes()
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

beforeEach(async () => {
  features = []
  others = []
  generateThrows = false
  sourceThrows = false
  generated.length = 0
  const models = (payload.db as unknown as { collections: Record<string, { collection: { deleteMany: (q: object) => Promise<unknown> } }>; versions: Record<string, { collection: { deleteMany: (q: object) => Promise<unknown> } }> })
  await models.collections['docs-pages']!.collection.deleteMany({})
  await models.versions?.['docs-pages']?.collection.deleteMany({})
})

describe('a page for every feature', () => {
  it('makes a draft for a new feature, from its fields only; a planned feature gets a short page marked Planned', async () => {
    expect(await onFeatureChange(payload, { source: 'catalog', feature: f('a', { details: 'internal notes go nowhere' }) })).toBe('made')
    expect(await onFeatureChange(payload, { source: 'catalog', feature: f('p', { stage: 'planned' }) })).toBe('made')
    const a = await page('a')
    expect([a.title, a.body, a._status, a.slug, a.sectionKey]).toEqual(['Feature a', 'How to use Feature a, step by step.', 'draft', 'feature-a', 'animals'])
    expect((await page('p')).body).toMatch(/^\*\*Planned\.\*\* This is what we intend/)
    expect(generated.map((g) => g.id)).toEqual(['a']) // planned pages aren't generated
  })

  it('marks a page out of date when the feature changes, keeping the published words until a new review', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    await reviewAndPublish((await page('a')).id)
    expect(await onFeatureChange(payload, { source: 'catalog', feature: f('a') })).toBe('same')
    expect(await onFeatureChange(payload, { source: 'catalog', feature: f('a', { title: 'Renamed', version: 'v2' }) })).toBe('outOfDate')
    const live = await page('a')
    expect([live.outOfDate, live._status, live.title]).toEqual([true, 'published', 'Feature a'])
    const draft = (await payload.findByID({ collection: 'docs-pages' as never, id: live.id, draft: true, overrideAccess: true })) as Doc
    expect(draft.title).toBe('Renamed')
  })

  it('archives a removed feature’s page and never deletes pages', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    expect(await onFeatureChange(payload, { source: 'catalog', removedId: 'a' })).toBe('archived')
    expect((await page('a')).archived).toBe(true)
    await expect(payload.delete({ collection: 'docs-pages' as never, id: (await page('a')).id, ...as(editor) })).rejects.toThrow()
  })

  it('never throws when the generator fails: the page is made and marked out of date', async () => {
    generateThrows = true
    expect(await onFeatureChange(payload, { source: 'catalog', feature: f('a') })).toBe('made')
    expect((await page('a')).outOfDate).toBe(true)
  })

  it('syncs every source: at least everything in Features, from each source, with removed ones archived', async () => {
    features = [f('a'), f('b')]
    others = [f('a', { section: { key: 'help', title: 'Help' } })]
    await syncDocs(payload)
    expect((await pages()).map((p) => `${p.source}:${p.featureId}`).sort()).toEqual(['catalog:a', 'catalog:b', 'extras-source:a'])
    features = [f('a')]
    await syncDocs(payload)
    expect((await page('b')).archived).toBe(true)
  })
})

describe('the lint, reviews and publishing', () => {
  it('finds internals: env names, file paths, IPs, hosts, keys, slugs and private terms; lets allowed names through', () => {
    const o = payload.config.custom!.docs as never
    const kinds = (t: string) => lint(o, t).map((h) => h.kind)
    expect(kinds('Set DATABASE_URL first')).toEqual(['environment variable'])
    expect(kinds('See src/lib/animals.ts')).toContain('file path')
    expect(kinds('Our server is 10.0.0.12')).toEqual(['IP address'])
    expect(kinds('Open admin.internal')).toEqual(['internal host'])
    expect(kinds('key sk-ant-abcdefghijklmnopqrstu')).toEqual(['key-like string'])
    expect(kinds('Stored in animal-records')).toEqual(['collection or field name'])
    expect(kinds('The secret-project-name launches')).toEqual(['private term'])
    expect(kinds('Watch it on YouTube. Your animals and their records stay yours.')).toEqual([])
  })

  it('refuses to publish an unreviewed page, a page with internals, or one edited after its review; only reviewers review', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    const id = (await page('a')).id
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })).rejects.toThrow(/approved/)
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { review: { approved: true, by: 'e1' } } as never, ...as(editor) })).rejects.toThrow(/reviewer/)
    await payload.update({ collection: 'docs-pages' as never, id, data: { review: { approved: true, by: 'r1' } } as never, ...as(reviewer) })
    await payload.update({ collection: 'docs-pages' as never, id, data: { body: 'Changed after the review.' } as never, ...as(editor) })
    expect(((await payload.findByID({ collection: 'docs-pages' as never, id, overrideAccess: true, draft: true })) as Doc).review?.hash ?? null).toBeNull() // the review was for other words
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })).rejects.toThrow(/approved/)
    await payload.update({ collection: 'docs-pages' as never, id, data: { body: 'Set DATABASE_URL first.' } as never, ...as(editor) })
    await payload.update({ collection: 'docs-pages' as never, id, data: { review: { approved: true, by: 'r1' } } as never, ...as(reviewer) })
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })).rejects.toThrow(/internal/)
    await payload.update({ collection: 'docs-pages' as never, id, data: { body: 'Plain words.' } as never, ...as(editor) })
    await reviewAndPublish(id)
    expect((await page('a'))._status).toBe('published')
  })

  it('shows the public only published pages that aren’t archived; editors see drafts', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    await onFeatureChange(payload, { source: 'catalog', feature: f('b') })
    await reviewAndPublish((await page('a')).id)
    expect((await payload.find({ collection: 'docs-pages' as never, ...as(null) })).docs.map((d) => (d as Doc).title)).toEqual(['Feature a'])
    expect((await payload.find({ collection: 'docs-pages' as never, ...as(editor) })).docs).toHaveLength(2)
    expect((await payload.find({ collection: 'docs-pages' as never, ...as(null) })).docs.every((d) => (d as Doc).review === undefined)).toBe(true)
    await onFeatureChange(payload, { source: 'catalog', removedId: 'a' })
    expect((await payload.find({ collection: 'docs-pages' as never, ...as(null) })).docs).toHaveLength(0)
  })
})

describe('the check, and reading the tree', () => {
  it('reports missing, out-of-date, unpublished, broken-link and lint problems, and passes when all is well', async () => {
    features = [f('a'), f('b'), f('p', { stage: 'planned' })]
    let r = await checkDocs(payload)
    expect(r.problems.filter((p) => p.kind === 'missing')).toHaveLength(3)
    await syncDocs(payload)
    r = await checkDocs(payload)
    expect(r.problems.map((p) => p.kind).sort()).toEqual(['unpublished', 'unpublished', 'unpublished']) // planned pages too: /docs holds everything in Features
    for (const id of ['a', 'b', 'p']) await reviewAndPublish((await page(id)).id)
    expect(await checkDocs(payload)).toEqual({ ok: true, problems: [] })
    const b = await page('b')
    // Editing a published page's words without a new review is refused; as a draft, then reviewed, it can go out.
    await expect(payload.update({ collection: 'docs-pages' as never, id: b.id, data: { body: 'See [this](/docs/animals/nowhere).' } as never, ...as(editor) })).rejects.toThrow(/approved/)
    await payload.update({ collection: 'docs-pages' as never, id: b.id, data: { body: 'See [this](/docs/animals/nowhere).', _status: 'draft' } as never, draft: true, ...as(editor) })
    await reviewAndPublish(b.id)
    expect((await checkDocs(payload)).problems).toEqual([{ kind: 'brokenLink', ref: String(b.id), detail: '/docs/animals/nowhere' }])
    await payload.db.updateOne({ collection: 'docs-pages', where: { id: { equals: b.id } }, data: { body: 'Set DATABASE_URL.' } } as never)
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('lint')
    // A page archived while its feature is still listed counts as missing.
    await payload.db.updateOne({ collection: 'docs-pages', where: { id: { equals: (await page('p')).id } }, data: { archived: true } } as never)
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('missing')
    features = [f('a', { version: 'v2' }), f('b'), f('p', { stage: 'planned' })]
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('outOfDate')
  })

  it('gives the site a tree of published pages, and a page by its path', async () => {
    features = [f('a'), f('b', { section: { key: 'help', title: 'Help' } })]
    await syncDocs(payload)
    await reviewAndPublish((await page('a')).id)
    const tree = await docsTree(payload)
    expect(tree).toEqual([{ key: 'animals', title: 'Animals', pages: [{ title: 'Feature a', summary: 'About Feature a', path: '/docs/animals/feature-a', stage: 'available', kind: 'feature' }] }])
    expect((await docsPage(payload, '/docs/animals/feature-a'))?.title).toBe('Feature a')
    expect(await docsPage(payload, '/docs/help/feature-b')).toBeNull() // still a draft
  })
})

describe('what the security read found', () => {
  it('keeps drafts and old versions from anyone but editors', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    const member = { id: 'm1', role: 'member', collection: 'users' }
    await expect(payload.findVersions({ collection: 'docs-pages' as never, ...as(member) })).rejects.toThrow()
    expect((await payload.findVersions({ collection: 'docs-pages' as never, ...as(editor) })).docs.length).toBeGreaterThan(0)
  })

  it('approves only with approved: true — a reviewer’s note alone approves nothing', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    const id = (await page('a')).id
    await payload.update({ collection: 'docs-pages' as never, id, data: { review: { notes: 'NOT OK - do not publish' } } as never, ...as(reviewer) })
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })).rejects.toThrow(/approved/)
    // A hash sent by the caller is ignored: the plugin stamps it.
    await payload.update({ collection: 'docs-pages' as never, id, data: { review: { approved: false, hash: 'forged' } } as never, ...as(reviewer) })
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { _status: 'published' } as never, ...as(editor) })).rejects.toThrow(/approved/)
  })

  it('allows many hand-written pages, and gives same-titled features their own paths', async () => {
    for (const t of ['Getting started', 'Glossary']) await payload.create({ collection: 'docs-pages' as never, data: { kind: 'extra', sectionKey: 'help', section: 'Help', slug: t.toLowerCase().replace(' ', '-'), title: t } as never, ...as(editor) })
    features = [f('a', { title: 'Same' }), f('b', { title: 'Same' })]
    await syncDocs(payload)
    expect([(await page('a')).slug, (await page('b')).slug].sort()).toEqual(['same', 'same-2'])
    // A feature titled like a collection gets a slug the lint won't refuse, so it can be published.
    features = [f('c', { title: 'Animal Records' })]
    await syncDocs(payload)
    expect((await page('c')).slug).toBe('animal-records-page')
    await reviewAndPublish((await page('c')).id)
    expect((await checkDocs(payload)).problems.some((p) => p.kind === 'duplicate')).toBe(false)
  })

  it('clears out-of-date once the new words are approved and published, so the check goes green', async () => {
    features = [f('a')]
    await syncDocs(payload)
    await reviewAndPublish((await page('a')).id)
    features = [f('a', { version: 'v2', title: 'Renamed' })]
    await syncDocs(payload)
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('outOfDate')
    await reviewAndPublish((await page('a')).id)
    expect(await checkDocs(payload)).toEqual({ ok: true, problems: [] })
  })

  it('hides an archived page from the public even when reading drafts', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    await reviewAndPublish((await page('a')).id)
    await onFeatureChange(payload, { source: 'catalog', removedId: 'a' })
    expect((await payload.find({ collection: 'docs-pages' as never, draft: true, ...as(null) })).docs).toHaveLength(0)
    expect(await docsPage(payload, '/docs/animals/feature-a')).toBeNull()
  })

  it('lints and reviews the section and path too, and hides internal fields from the public', async () => {
    await onFeatureChange(payload, { source: 'catalog', feature: f('a') })
    const id = (await page('a')).id
    await reviewAndPublish(id)
    await expect(payload.update({ collection: 'docs-pages' as never, id, data: { section: 'Set DATABASE_URL' } as never, ...as(editor) })).rejects.toThrow(/approved|internal/)
    const pub = (await payload.find({ collection: 'docs-pages' as never, ...as(null) })).docs[0] as Doc
    expect(['source', 'featureId', 'generatedFrom', 'outOfDate', 'review'].filter((k) => k in pub)).toEqual([])
  })

  it('leaves pages alone when a source fails or returns nothing, and the check says so', async () => {
    features = [f('a')]
    await syncDocs(payload)
    sourceThrows = true
    expect((await syncDocs(payload)).failedSources).toEqual(['catalog'])
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('sourceFailed')
    sourceThrows = false
    features = []
    await syncDocs(payload)
    expect((await page('a')).archived).toBeFalsy()
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('emptySource')
  })

  it('tries a failed draft again next sync, and gives the generator only the feature’s own fields', async () => {
    generateThrows = true
    features = [{ ...f('a'), secretField: 'internal' } as never]
    await syncDocs(payload)
    expect((await page('a')).generatedFrom ?? null).toBeNull()
    generateThrows = false
    await syncDocs(payload)
    const latest = (await payload.findByID({ collection: 'docs-pages' as never, id: (await page('a')).id, draft: true, overrideAccess: true })) as Doc
    expect([latest.generatedFrom, latest.body]).toEqual(['v1', 'How to use Feature a, step by step.'])
    expect(generated.at(-1)!.keys).not.toContain('secretField')
  })

  it('sees through escaping: Markdown, HTML entities and comments, invisible characters, look-alike hyphens', () => {
    const o = payload.config.custom!.docs as never
    for (const t of ['DATABASE\\_URL', 'DATABASE&#95;URL', 'DATABASE<!-- -->_URL', 'DATA\u200BBASE_URL', 'secret\\-project\\-name', 'secret\u2011project\u2011name', 'animal\\-records', 'The SECRET-PROJECT-NAME', 'DATABASE<b></b>_URL', 'DATABASE<span>_URL</span>', 'secret-<i></i>project-name'])
      expect(lint(o, t).length, t).toBeGreaterThan(0)
  })

  it('checks links in rich text, the allow-list, and members pages, and keeps archived pages out of docsPage', async () => {
    const o = payload.config.custom!.docs as never
    expect(lint(o, textOf({ root: { children: [{ type: 'link', fields: { url: 'http://10.0.0.1/admin' }, children: [{ text: 'here' }] }] } })).length).toBeGreaterThan(0)
    expect(lint(o, 'youtube and YouTube')).toEqual([])
    // The allow-list lets a public name through that a rule would otherwise flag.
    expect(lint({ ...(o as object), allow: ['STRIPE_CHECKOUT'] } as never, 'Pay with STRIPE_CHECKOUT')).toEqual([])
    expect(lint(o, 'Pay with STRIPE_CHECKOUT').length).toBe(1)
    features = [f('m', { stage: 'members' })]
    await syncDocs(payload)
    expect((await checkDocs(payload)).problems.map((p) => p.kind)).toContain('unpublished')
    await reviewAndPublish((await page('m')).id)
    await payload.db.updateOne({ collection: 'docs-pages', where: { id: { equals: (await page('m')).id } }, data: { archived: true } } as never)
    expect(await docsPage(payload, '/docs/animals/feature-m')).toBeNull()
  })
})
