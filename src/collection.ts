import type { Access, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'

import { lint, textOf } from './lint.js'
import type { Resolved } from './types.js'
import { bodyHash, DocsError } from './util.js'

const yes = async (a: Access, args: Parameters<Access>[0]) => (await a(args)) === true
const SYNC = Symbol.for('docs.sync')

/**
 * Before a page is saved: the lint refuses anything internal in a published page; editing the body clears its
 * review; only reviewers set a review; and a page can't be published unreviewed.
 */
const beforeChange =
  (o: Resolved): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req }) => {
    const sync = Boolean((req.context as Record<symbol, unknown>)?.[SYNC])
    const next = { ...originalDoc, ...data }
    const hash = bodyHash(`${next.title ?? ''}\n${next.summary ?? ''}\n${textOf(next.body)}`)
    const reviewChanged = data.review !== undefined && JSON.stringify(data.review ?? null) !== JSON.stringify(originalDoc?.review ?? null)
    if (reviewChanged && !sync && !(await yes(o.review, { req, data } as never))) throw new DocsError('notReviewer', 'Only a reviewer can mark a page reviewed.', 403)
    // A review counts only for the words it saw.
    if (next.review?.hash && next.review.hash !== hash) data.review = null
    if (reviewChanged && data.review) data.review = { ...data.review, hash, at: data.review.at ?? new Date().toISOString() }
    if (next._status === 'published') {
      const hits = lint(o, `${next.title ?? ''}\n${next.summary ?? ''}\n${textOf(next.body)}`)
      if (hits.length) throw new DocsError('lint', `This page mentions something internal (${[...new Set(hits.map((h) => h.kind))].join(', ')}). Rewrite it before publishing.`)
      const review = data.review === undefined ? originalDoc?.review : data.review
      if (!review?.hash || review.hash !== hash) throw new DocsError('unreviewed', 'A page has to be reviewed, as it is now, before it’s published.')
    }
    return data
  }

export const docsCollection = (o: Resolved): CollectionConfig => {
  const editor: Access = async (args) => yes(o.edit, args)
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
    },
    hooks: { beforeChange: [beforeChange(o)] },
    indexes: [{ fields: ['source', 'featureId'], unique: true }],
    fields: [
      { name: 'kind', type: 'select', options: ['feature', 'extra'], required: true, defaultValue: 'extra' },
      { name: 'source', type: 'text', admin: { readOnly: true } },
      { name: 'featureId', type: 'text', admin: { readOnly: true } },
      { name: 'sectionKey', type: 'text', required: true, index: true },
      { name: 'section', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, index: true },
      { name: 'title', type: 'text', required: true },
      { name: 'summary', type: 'textarea' },
      { name: 'body', type: 'textarea', admin: { description: 'Markdown.' } },
      { name: 'stage', type: 'select', options: ['available', 'members', 'in-progress', 'planned'] },
      { name: 'order', type: 'number' },
      { name: 'generatedFrom', type: 'text', admin: { readOnly: true, description: 'The feature version this page was written from.' } },
      { name: 'outOfDate', type: 'checkbox', admin: { readOnly: true } },
      { name: 'archived', type: 'checkbox', admin: { readOnly: true } },
      {
        name: 'review',
        type: 'group',
        access: { read: async (args) => yes(o.edit, args as never) },
        fields: [
          { name: 'by', type: 'text' },
          { name: 'at', type: 'date' },
          { name: 'notes', type: 'textarea' },
          { name: 'hash', type: 'text', admin: { readOnly: true } },
        ],
      },
    ],
  }
}

export { SYNC }
