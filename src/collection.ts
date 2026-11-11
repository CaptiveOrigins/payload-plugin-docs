import type { Access, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'

import { lint, textOf } from './lint.js'
import type { Resolved } from './types.js'
import { bodyHash, DocsError } from './util.js'

const yes = async (a: Access, args: Parameters<Access>[0]) => (await a(args)) === true

/** Everything a reader sees on a page, for the review hash and the lint: section, path, title, summary and body. */
export const pageText = (p: Record<string, any>) => [p.section, p.sectionKey, p.slug, p.title, p.summary, textOf(p.body)].map((v) => String(v ?? '')).join('\n') // eslint-disable-line @typescript-eslint/no-explicit-any

const EMPTY = { approved: false, by: null, at: null, notes: null, hash: null }

/**
 * Before a page is saved:
 * - only reviewers change the review, and a review approves only when `approved` is true;
 * - an approval holds only for the words it saw: changing any of them clears it;
 * - a published page must be approved for its words, as they are now, and pass the lint;
 * - publishing an approved page clears its out-of-date flag.
 */
const beforeChange =
  (o: Resolved): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req }) => {
    const next = { ...originalDoc, ...data }
    const hash = bodyHash(pageText(next))
    const reviewChanged = data.review !== undefined && JSON.stringify(data.review ?? null) !== JSON.stringify(originalDoc?.review ?? null)
    if (reviewChanged && !(await yes(o.review, { req, data } as never))) throw new DocsError('notReviewer', 'Only a reviewer can review a page.', 403)
    if (reviewChanged && data.review) {
      // The hash is the plugin's, never the caller's: an approval is stamped with the words it approves.
      data.review = data.review.approved === true ? { ...data.review, hash, at: new Date().toISOString() } : { ...data.review, approved: false, hash: null }
    } else if (next.review?.hash && next.review.hash !== hash) data.review = EMPTY
    if (next._status === 'published') {
      const hits = lint(o, pageText(next))
      if (hits.length) throw new DocsError('lint', `This page mentions something internal (${[...new Set(hits.map((h) => h.kind))].join(', ')}). Rewrite it before publishing.`)
      const review = data.review === undefined ? originalDoc?.review : data.review
      if (review?.approved !== true || !review.hash || review.hash !== hash) throw new DocsError('unreviewed', 'A page has to be approved by a reviewer, as it is now, before it’s published.')
      data.outOfDate = false
    }
    return data
  }

export const docsCollection = (o: Resolved): CollectionConfig => {
  const editor: Access = async (args) => yes(o.edit, args)
  const editorField = { read: async (args: unknown) => yes(o.edit, args as never) }
  return {
    slug: o.slug,
    labels: { singular: 'Docs page', plural: 'Docs pages' },
    admin: { group: o.adminGroup, useAsTitle: 'title', defaultColumns: ['title', 'section', 'kind', 'outOfDate', '_status'] },
    versions: { drafts: true, maxPerDoc: 20 },
    access: {
      // The public sees published pages that aren't archived; editors see everything.
      read: async (args) => ((await yes(o.edit, args)) ? true : ({ and: [{ _status: { equals: 'published' } }, { archived: { not_equals: true } }] } as Where)),
      create: editor,
      update: editor,
      // Pages are archived, never deleted, so /docs never loses a feature's page by accident.
      delete: () => false,
      // Drafts and old versions are for editors: unreviewed words never reach anyone else.
      readVersions: editor,
    },
    hooks: { beforeChange: [beforeChange(o)] },
    indexes: [{ fields: ['source', 'featureId'] }],
    fields: [
      { name: 'kind', type: 'select', options: ['feature', 'extra'], required: true, defaultValue: 'extra' },
      { name: 'source', type: 'text', admin: { readOnly: true }, access: editorField },
      { name: 'featureId', type: 'text', admin: { readOnly: true }, access: editorField },
      { name: 'sectionKey', type: 'text', required: true, index: true },
      { name: 'section', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, index: true },
      { name: 'title', type: 'text', required: true },
      { name: 'summary', type: 'textarea' },
      { name: 'body', type: 'textarea', admin: { description: 'Markdown.' } },
      { name: 'stage', type: 'select', options: ['available', 'members', 'in-progress', 'planned'] },
      { name: 'order', type: 'number' },
      { name: 'generatedFrom', type: 'text', admin: { readOnly: true, description: 'The feature version this page was written from.' }, access: editorField },
      { name: 'outOfDate', type: 'checkbox', admin: { readOnly: true }, access: editorField },
      { name: 'archived', type: 'checkbox', admin: { readOnly: true } },
      {
        name: 'review',
        type: 'group',
        access: editorField,
        fields: [
          { name: 'approved', type: 'checkbox', admin: { description: 'Tick to approve these words. A note alone doesn’t approve.' } },
          { name: 'by', type: 'text' },
          { name: 'at', type: 'date' },
          { name: 'notes', type: 'textarea' },
          { name: 'hash', type: 'text', admin: { readOnly: true } },
        ],
      },
    ],
  }
}

