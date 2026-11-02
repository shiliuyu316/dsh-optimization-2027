/**
 * Per-session automatic re-arm threshold, on disk.
 *
 * The threshold used to come straight out of the config, which meant changing
 * it required editing a YAML file and restarting the Host. A number a person
 * can see in the panel and cannot change without leaving the conversation is
 * half a setting; this file is the other half.
 *
 * Same two rules as the tier store, for the same reasons:
 *
 * - Only an explicit set writes. A session that never touched the field keeps
 *   no file and falls through to the configured default, so editing the config
 *   still moves every session that never overrode it.
 * - An unreadable file is treated as absent, not as off. Reporting 0 would
 *   claim the session chose to stop re-arming; it did not.
 *
 * 0 is a real value here — it is the off switch — so it is stored as 0 rather
 * than deleted. "Blank in the panel" and "0 in the panel" mean the same thing,
 * and both land here as 0.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { safeSessionKey } from './ledger.js'

/** A threshold is a whole count of messages. Negative and junk mean off. */
function clampDistance(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n)
}

export class RearmStore {
  #dir
  #cache = new Map()

  constructor(dir) {
    this.#dir = dir
  }

  get dir() {
    return this.#dir
  }

  file(sessionId) {
    return join(this.#dir, `rearm-${safeSessionKey(sessionId)}.json`)
  }

  /**
   * The threshold this session last chose, or null when it never chose one or
   * the record cannot be read. Null means "ask the configured default".
   */
  read(sessionId) {
    const key = safeSessionKey(sessionId)
    if (this.#cache.has(key)) return this.#cache.get(key)
    const file = this.file(sessionId)
    let distance = null
    if (existsSync(file)) {
      try {
        const row = JSON.parse(readFileSync(file, 'utf8'))
        const raw = row?.distance
        // A stored 0 is a choice; anything unreadable is not.
        if (typeof raw === 'number' && Number.isFinite(raw)) distance = clampDistance(raw)
      } catch {
        distance = null
      }
    }
    this.#cache.set(key, distance)
    return distance
  }

  /** Record a choice. Returns the threshold actually stored, after clamping. */
  write(sessionId, distance) {
    const next = clampDistance(distance)
    const file = this.file(sessionId)
    mkdirSync(this.#dir, { recursive: true })
    const temp = `${file}.${Math.random().toString(36).slice(2, 8)}.tmp`
    writeFileSync(temp, `${JSON.stringify({ distance: next })}\n`, 'utf8')
    renameSync(temp, file)
    this.#cache.set(safeSessionKey(sessionId), next)
    return next
  }

  /** Drop the cached answer so the next read goes back to the file. */
  forget(sessionId) {
    this.#cache.delete(safeSessionKey(sessionId))
  }
}
