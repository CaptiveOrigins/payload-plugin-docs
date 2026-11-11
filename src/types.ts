import type { Access, Payload, PayloadRequest } from 'payload'

export type Req = Partial<PayloadRequest>
export type Stage = 'available' | 'members' | 'in-progress' | 'planned'

/** One feature, from whatever lists them (a roadmap plugin's catalog, the site's own list). */
export type Feature = {
  id: string
  section: { key: string; title: string }
  title: string
  summary?: string
  details?: string
  stage: Stage
  audience?: string
  /** Site paths the feature's pages live at, for the generator's UI text and for link checks. */
  links?: string[]
  notesForDocs?: string
  /** Changes whenever the feature's words change: a hash or an updatedAt. */
  version: string
}

export type FeatureSource = { name: string; list: (args: { payload: Payload; req?: Req }) => Promise<Feature[]> }

/** The site's own model call. Gets the feature's fields and the user-facing text only: never code or schema. */
export type Generate = (args: { feature: Feature; uiText?: string; payload: Payload; req?: Req }) => Promise<{ summary: string; body: string }>

export type DocsOptions = {
  sources?: FeatureSource[]
  generate?: Generate
  /** The user-facing text of a feature's pages, for the generator (optional). */
  uiTextFor?: (feature: Feature, args: { payload: Payload }) => Promise<string | undefined>
  /** Who edits pages and sees drafts. Required. */
  access: { edit: Access; review: Access }
  /** Words that must never appear on a page (private names, internal hosts). Read at start-up. */
  privateTerms?: string[]
  /** Public names the lint lets through (Payload, Stripe, YouTube). */
  allow?: string[]
  /** The site's own collection and field slugs, which the lint refuses. Default: every collection slug in the config. */
  slugs?: string[]
  /** Where pages live: `${basePath}/${section}/${slug}`. Default '/docs'. */
  basePath?: string
  collectionSlug?: string
  adminGroup?: string
}

export type Resolved = {
  slug: string
  sources: FeatureSource[]
  generate?: Generate
  uiTextFor?: DocsOptions['uiTextFor']
  edit: Access
  review: Access
  privateTerms: string[]
  allow: string[]
  slugs: string[]
  basePath: string
  adminGroup: string
}
