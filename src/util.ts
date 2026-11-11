import { createHash } from 'node:crypto'

import { APIError, type Payload } from 'payload'

import type { Resolved } from './types.js'

export class DocsError extends APIError<{ code: string }> {
  code: string
  constructor(code: string, message: string, status = 400) {
    super(message, status, { code }, true)
    this.code = code
  }
}

export const configOf = (payload: Payload): Resolved => {
  const o = payload.config.custom?.docs as Resolved | undefined
  if (!o) throw new Error('Docs: the plugin is not configured on this site.')
  return o
}

export const bodyHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)
export const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'page'
