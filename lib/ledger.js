/**
 * Claim ledger.
 *
 * The one discipline this enforces: a claim that the answer rests on must
 * carry either evidence (something you observed) or a check (something that
 * would settle it). A load-bearing claim with neither is a guess wearing a
 * conclusion's clothes, and the ledger refuses to store it that way.
 *
 * Two behaviours are deliberately not softened:
 *
 * - settle() with holds=false keeps the claim and marks it falsified instead
 *   of deleting it. A model that deletes a claim it just learned was wrong
 *   forgets it learned anything.
 * - audit() counts unverified load-bearing claims separately from unsupported
 *   ones. "I have not checked this yet" and "I have nothing to check this
 *   against" are different problems with different fixes.
 *
 * Storage is append-only JSONL per session, so the ledger survives compaction
 * and a restart, and every revision of a claim is visible in the file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHANNELS = ['observed', 'derived', 'assumed', 'guessed']
const WEAK = new Set(['assumed', 'guessed'])

function nowIso() {
  return new Date().toISOString()
}

/**
 * One session id, one filename. Exported because the stored tier uses the same
 * rule: two files that name the same session must never disagree about which
 * characters are legal in a name.
 */
export function safeSessionKey(sessionId) {
  const raw = String(sessionId ?? '').trim()
  const usable = raw.length > 0 ? raw : 'default'
  return usable.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
}

/**
 * One ledger per session. In-memory state is rebuilt from the JSONL file on
 * first use, so a restart resumes rather than restarts.
 */
export class ClaimLedger {
  #dir
  #session
  #file
  #claims = new Map()
  #loaded = false
  #seq = 0

  constructor(dir, sessionId) {
    this.#dir = dir
    this.#session = safeSessionKey(sessionId)
    this.#file = join(dir, `ledger-${this.#session}.jsonl`)
  }

  get file() {
    return this.#file
  }

  get session() {
    return this.#session
  }

  #load() {
    if (this.#loaded) return
    this.#loaded = true
    if (!existsSync(this.#file)) return
    let raw = ''
    try {
      raw = readFileSync(this.#file, 'utf8')
    } catch {
      return
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let row
      try {
        row = JSON.parse(trimmed)
      } catch {
        continue
      }
      this.#apply(row)
    }
  }

  #apply(row) {
    if (row?.op === 'add' && row.claim?.id) {
      this.#claims.set(row.claim.id, { ...row.claim })
      const n = Number(String(row.claim.id).replace(/^c/, ''))
      if (Number.isFinite(n) && n > this.#seq) this.#seq = n
      return
    }
    if (row?.op === 'settle' && row.id) {
      const claim = this.#claims.get(row.id)
      if (claim === undefined) return
      claim.channel = row.holds === true ? 'observed' : claim.channel === 'observed' ? 'observed' : 'assumed'
      claim.settled = true
      claim.holds = row.holds === true
      claim.falsified = row.holds === false
      if (typeof row.result === 'string' && row.result.length > 0) claim.result = row.result
      claim.settledAt = row.at ?? claim.settledAt
    }
  }

  #append(row) {
    mkdirSync(this.#dir, { recursive: true })
    appendFileSync(this.#file, `${JSON.stringify(row)}\n`, 'utf8')
    this.#apply(row)
  }

  add({ text, channel, loadBearing, evidence, check }) {
    this.#load()
    const body = String(text ?? '').trim()
    if (body.length === 0) throw new Error('claim: add needs text')
    const chan = CHANNELS.includes(channel) ? channel : 'assumed'
    const bearing = loadBearing === true
    const ev = String(evidence ?? '').trim()
    const ck = String(check ?? '').trim()
    if (bearing && ev.length === 0 && ck.length === 0) {
      throw new Error(
        'claim: add with loadBearing needs evidence or a check. ' +
          'Without either it is a guess, and a guess may not carry the answer. ' +
          'Give evidence, give a check, or set loadBearing:false.',
      )
    }
    this.#seq += 1
    const claim = {
      id: `c${this.#seq}`,
      text: body,
      channel: chan,
      loadBearing: bearing,
      evidence: ev,
      check: ck,
      weak: WEAK.has(chan),
      settled: false,
      holds: null,
      falsified: false,
      result: '',
      createdAt: nowIso(),
    }
    this.#append({ op: 'add', at: claim.createdAt, claim })
    return claim
  }

  settle(id, { holds, result }) {
    this.#load()
    const key = String(id ?? '').trim()
    const claim = this.#claims.get(key)
    if (claim === undefined) throw new Error(`claim: settle found no claim ${key}`)
    const row = {
      op: 'settle',
      at: nowIso(),
      id: key,
      holds: holds === true,
      result: String(result ?? '').trim(),
    }
    this.#append(row)
    return this.#claims.get(key)
  }

  list() {
    this.#load()
    return [...this.#claims.values()]
  }

  audit() {
    this.#load()
    const all = [...this.#claims.values()]
    const loadBearing = all.filter((claim) => claim.loadBearing)
    const falsified = all.filter((claim) => claim.falsified === true)
    const unverified = loadBearing.filter((claim) => claim.settled !== true)
    const unsupported = loadBearing.filter(
      (claim) => claim.evidence.length === 0 && claim.check.length === 0,
    )
    const weak = loadBearing.filter((claim) => claim.weak === true)
    const total = all.length
    return {
      session: this.#session,
      total,
      loadBearing: loadBearing.length,
      verified: loadBearing.filter((claim) => claim.settled === true && claim.holds === true).length,
      unverified: unverified.length,
      unsupported: unsupported.length,
      weak: weak.length,
      falsified: falsified.length,
      clean: unverified.length === 0 && unsupported.length === 0 && falsified.length === 0,
      claims: all,
    }
  }
}

const MARK = {
  observed: 'OBS',
  derived: 'DRV',
  assumed: 'ASM',
  guessed: 'GSX',
}

export function renderClaim(claim) {
  const flags = []
  if (claim.loadBearing) flags.push('load-bearing')
  if (claim.falsified) flags.push('FALSIFIED')
  else if (claim.settled && claim.holds) flags.push('verified')
  else if (claim.loadBearing) flags.push('unverified')
  const suffix = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
  const detail = claim.result.length > 0 ? `\n      result: ${claim.result}` : ''
  const basis =
    claim.evidence.length > 0
      ? `\n      evidence: ${claim.evidence}`
      : claim.check.length > 0
        ? `\n      check: ${claim.check}`
        : ''
  return `${claim.id} ${MARK[claim.channel] ?? claim.channel} ${claim.text}${suffix}${basis}${detail}`
}

export function renderAudit(audit) {
  const lines = [
    `ledger ${audit.session}: ${audit.total} claim${audit.total === 1 ? '' : 's'}, ` +
      `${audit.loadBearing} load-bearing, ${audit.verified} verified, ` +
      `${audit.unverified} unverified, ${audit.unsupported} unsupported, ${audit.falsified} falsified`,
  ]
  if (audit.clean) {
    lines.push('clean: every load-bearing claim carries evidence or a check, and none is falsified.')
  } else {
    if (audit.unsupported > 0) {
      lines.push(
        `${audit.unsupported} load-bearing claim(s) carry neither evidence nor a check — those are guesses carrying the answer.`,
      )
    }
    if (audit.unverified > 0) {
      lines.push(`${audit.unverified} load-bearing claim(s) have not been settled.`)
    }
    if (audit.falsified > 0) {
      lines.push(
        `${audit.falsified} claim(s) were falsified. They stay in the ledger on purpose: a deleted mistake is a mistake you will repeat.`,
      )
    }
  }
  if (audit.total > 0) {
    lines.push('', ...audit.claims.map(renderClaim))
  }
  return lines.join('\n')
}
