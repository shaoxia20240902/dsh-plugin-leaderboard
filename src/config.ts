import Schema from 'schemastery'
import { DEFAULT_EXCLUDES, DEFAULT_TOPIC } from './types.ts'

/** Plugin configuration accepted from cordis.yml. */
export interface Config {
  /** Optional GitHub token; falls back to GITHUB_TOKEN / GH_TOKEN. */
  githubToken?: string
  /** GitHub topic that defines the catalog. */
  topic: string
  /** How long a successful GitHub snapshot is reused. */
  cacheTtlMs: number
  /** Star-sorted GitHub search pages (100 repos each). */
  starPages: number
  /** Recently-updated GitHub search pages (100 repos each). */
  updatedPages: number
  /** Repositories dropped from every board, as owner/name. */
  excludes: string[]
}

/** Schemastery schema. Defaults live on the fields. */
export const Config: Schema<Config> = Schema.object({
  githubToken: Schema.string(),
  topic: Schema.string().default(DEFAULT_TOPIC),
  cacheTtlMs: Schema.number().default(10 * 60 * 1000),
  starPages: Schema.number().default(3),
  updatedPages: Schema.number().default(2),
  excludes: Schema.array(Schema.string()).default([...DEFAULT_EXCLUDES]),
})
