/**
 * Per-session reasoning tier, on disk.
 *
 * Why this exists: the tier a session runs at used to live only in a Map
 * inside the running process. A restart dropped every session back to the
 * configured default, so a session you had set to tier 3 came back at tier 0
 * and nothing said so. A setting the user made and cannot see being undone is
 * worse than a setting that was never offered.
 *
 * Two rules that follow from that:
 *
 * - Only an explicit set writes. A session that was never switched keeps no
 *   file and falls through to the configured default, so "new sessions start
 *   at the off switch" stays true no matter what older sessions did.
 * - An unreadable file is treated as absent, not as the default. Falling back
 *   to the configured default is the honest answer to "I cannot read what you
 *   chose"; silently pinning the session to 0 would be inventing a decision.
 *
 * Writes go through a temp file and a rename, so a crash mid-write leaves the
 * previous tier in place instead of a half-written file that reads as absent.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { clampLevel } from './levels.js'
import { safeSessionKey } from './ledger.js'

export class LevelStore {
  #dir
  #cache = new Map()

  constructor(dir) {
    this.#dir = dir
  }

  get dir() {
    return this.#dir
  }

  file(sessionId) {
    return join(this.#dir, `level-${safeSessionKey(sessionId)}.json`)
  }

  /**
   * The tier this session last chose, or null when it never chose one or the
   * record cannot be read. Null means "ask the configured default".
   */
  read(sessionId) {
    const key = safeSessionKey(sessionId)
    if (this.#cache.has(key)) return this.#cache.get(key)
    const file = this.file(sessionId)
    let level = null
    if (existsSync(file)) {
      try {
        const row = JSON.parse(readFileSync(file, 'utf8'))
        const raw = row?.level
        // clampLevel answers the default for junk; only a real number is a
        // recorded choice.
        if (typeof raw === 'number' && Number.isFinite(raw)) level = clampLevel(raw)
      } catch {
        level = null
      }
    }
    this.#cache.set(key, level)
    return level
  }

  /** Record a choice. Returns the tier actually stored, after clamping. */
  write(sessionId, level) {
    const next = clampLevel(level)
    const file = this.file(sessionId)
    mkdirSync(this.#dir, { recursive: true })
    const temp = `${file}.${Math.random().toString(36).slice(2, 8)}.tmp`
    writeFileSync(temp, `${JSON.stringify({ level: next })}\n`, 'utf8')
    renameSync(temp, file)
    this.#cache.set(safeSessionKey(sessionId), next)
    return next
  }

  /** Drop the cached answer so the next read goes back to the file. */
  forget(sessionId) {
    this.#cache.delete(safeSessionKey(sessionId))
  }
}
