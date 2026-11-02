/**
 * Declarative custom tools.
 *
 * The upstream design let the model write JavaScript that was loaded into the
 * Host process. That is privilege escalation the user never agreed to: the
 * model's own code gets the plugin's full authority, and one syntax error takes
 * the whole plugin down with it. This version keeps the useful half — a model
 * that notices the same command sequence three times should be able to stop
 * retyping it — and drops the dangerous half:
 *
 *   a custom tool is a JSON declaration: name, description, JSON Schema for its
 *   parameters, and a PowerShell command template with {{placeholders}}.
 *
 * Two properties fall out of that and are worth stating explicitly:
 *
 * 1. A parameter cannot inject a shell operator. Every placeholder is inserted
 *    as a PowerShell single-quoted literal with internal quotes doubled, so the
 *    value is data at the shell level no matter what it contains.
 * 2. The authority of a custom tool is exactly the authority the model already
 *    has through the shell tool. Declaring a tool grants nothing new.
 *
 * A missing placeholder is an error, never an empty string: silently
 * substituting nothing turns `git checkout {{branch}}` into `git checkout`,
 * which is a different command with a different effect.
 *
 * Storage is one .json (machine) plus one .md (human and model) per tool. The
 * prompt gets only an index — name, summary, absolute path to the .md — because
 * the descriptions grow without bound and would crowd out the actual task.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { psQuote } from './shell.js'

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,46}$/
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const SUMMARY_LIMIT = 160

/**
 * Names a custom tool may not take. These are either real tools in this profile
 * or names whose shadowing would silently change what an existing call does.
 */
const RESERVED = new Set([
  'bash',
  'pwsh',
  'run_code',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'skill',
  'subagent',
  'workflow',
  'present',
  'ask_user_question',
  'todo_write',
  'web_search',
  'web_fetch',
  'shell2027',
  'shell_reset',
  'tool2027',
  'claim',
  'analyst_brief',
])

export function slugOf(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 47)
}

export function placeholdersIn(template) {
  const found = new Set()
  for (const match of String(template ?? '').matchAll(PLACEHOLDER)) found.add(match[1])
  return [...found]
}

/**
 * Substitute every placeholder with a PowerShell single-quoted literal.
 * Throws on a placeholder with no supplied value, and on a parameter the
 * schema does not declare, so the template and the schema cannot drift apart.
 */
export function renderCommand(template, schema, args) {
  const declared = new Set(Object.keys(schema?.properties ?? {}))
  const used = placeholdersIn(template)
  for (const name of used) {
    if (!declared.has(name)) {
      throw new Error(
        `template uses {{${name}}} but the parameter schema does not declare it. ` +
          `Declared: ${[...declared].join(', ') || '(none)'}`,
      )
    }
  }
  const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
  for (const name of required) {
    if (args?.[name] === undefined || args[name] === null || args[name] === '') {
      throw new Error(`missing required parameter: ${name}`)
    }
  }
  return String(template).replace(PLACEHOLDER, (_whole, name) => {
    const value = args?.[name]
    if (value === undefined || value === null) {
      throw new Error(
        `{{${name}}} has no value. Refusing to substitute an empty string: ` +
          'that would change which command runs.',
      )
    }
    return psQuote(typeof value === 'string' ? value : JSON.stringify(value))
  })
}

function validateDeclaration(decl) {
  const problems = []
  const name = slugOf(decl?.name)
  if (!NAME_PATTERN.test(name)) {
    problems.push(`name "${decl?.name}" must match ${NAME_PATTERN}`)
  }
  if (RESERVED.has(name)) problems.push(`name "${name}" is reserved`)
  const description = String(decl?.description ?? '').trim()
  if (description.length === 0) problems.push('description is required')
  const command = String(decl?.command ?? '').trim()
  if (command.length === 0) problems.push('command template is required')
  const parameters = decl?.parameters
  if (parameters !== undefined && (typeof parameters !== 'object' || parameters === null)) {
    problems.push('parameters must be a JSON Schema object')
  }
  return { name, description, command, parameters, problems }
}

function renderToolDoc(decl) {
  const params = Object.entries(decl.parameters?.properties ?? {})
  const required = new Set(Array.isArray(decl.parameters?.required) ? decl.parameters.required : [])
  const lines = [
    `# ${decl.name}`,
    '',
    decl.description,
    '',
    '## Parameters',
    '',
  ]
  if (params.length === 0) {
    lines.push('_None._')
  } else {
    for (const [key, spec] of params) {
      const type = spec?.type ?? 'any'
      const flag = required.has(key) ? ' (required)' : ''
      const desc = typeof spec?.description === 'string' ? ` — ${spec.description}` : ''
      lines.push(`- \`${key}\`: ${type}${flag}${desc}`)
    }
  }
  lines.push('', '## Command template', '', '```powershell', decl.command, '```', '')
  lines.push(
    'Each `{{name}}` is inserted as a PowerShell single-quoted literal, so a',
    'value cannot inject an operator. A placeholder with no value is an error,',
    'not an empty string.',
    '',
  )
  return lines.join('\n')
}

/**
 * The store owns the directory, the on-disk format, and the live tool
 * registrations. `register` is a callback supplied by index.js that performs
 * ctx.tools.register() and returns a disposer; the store never touches ctx.
 */
export class CustomToolStore {
  #dir
  #register
  #disposers = new Map()
  #decls = new Map()

  constructor(dir, register) {
    this.#dir = dir
    this.#register = register
  }

  get dir() {
    return this.#dir
  }

  #jsonPath(name) {
    return join(this.#dir, `${name}.json`)
  }

  mdPath(name) {
    return join(this.#dir, `${name}.md`)
  }

  load() {
    mkdirSync(this.#dir, { recursive: true })
    const files = readdirSync(this.#dir).filter((file) => file.endsWith('.json'))
    const problems = []
    for (const file of files) {
      const full = join(this.#dir, file)
      let decl
      try {
        decl = JSON.parse(readFileSync(full, 'utf8'))
      } catch (error) {
        problems.push(`${file}: ${error.message}`)
        continue
      }
      const checked = validateDeclaration(decl)
      if (checked.problems.length > 0) {
        problems.push(`${file}: ${checked.problems.join('; ')}`)
        continue
      }
      this.#install(checked, { writeDoc: !existsSync(this.mdPath(checked.name)) })
    }
    return { loaded: this.#decls.size, problems }
  }

  #install(decl, { writeDoc }) {
    this.#uninstall(decl.name)
    const dispose = this.#register(decl)
    this.#disposers.set(decl.name, dispose)
    this.#decls.set(decl.name, decl)
    if (writeDoc) {
      mkdirSync(this.#dir, { recursive: true })
      writeFileSync(this.mdPath(decl.name), renderToolDoc(decl), 'utf8')
    }
  }

  #uninstall(name) {
    const dispose = this.#disposers.get(name)
    if (dispose !== undefined) {
      try {
        dispose()
      } catch {}
      this.#disposers.delete(name)
    }
    this.#decls.delete(name)
  }

  /** Create or replace one tool. Returns the validated declaration. */
  save(decl) {
    const checked = validateDeclaration(decl)
    if (checked.problems.length > 0) {
      throw new Error(`tool2027: ${checked.problems.join('; ')}`)
    }
    mkdirSync(this.#dir, { recursive: true })
    const payload = {
      name: checked.name,
      description: checked.description,
      parameters: checked.parameters ?? { type: 'object', properties: {} },
      command: checked.command,
    }
    writeFileSync(this.#jsonPath(checked.name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    writeFileSync(this.mdPath(checked.name), renderToolDoc(payload), 'utf8')
    this.#install(checked, { writeDoc: false })
    return payload
  }

  remove(name) {
    const key = slugOf(name)
    if (!this.#decls.has(key) && !existsSync(this.#jsonPath(key))) {
      throw new Error(`tool2027: no custom tool named ${key}`)
    }
    this.#uninstall(key)
    rmSync(this.#jsonPath(key), { force: true })
    rmSync(this.mdPath(key), { force: true })
    return key
  }

  list() {
    return [...this.#decls.values()].map((decl) => ({
      name: decl.name,
      description: decl.description,
      doc: this.mdPath(decl.name),
      params: Object.keys(decl.parameters?.properties ?? {}),
    }))
  }

  get(name) {
    return this.#decls.get(slugOf(name)) ?? null
  }

  /**
   * The prompt index. One line per tool, never the full description: the store
   * is unbounded and the prompt is not.
   */
  renderIndex() {
    const tools = this.list()
    if (tools.length === 0) return ''
    const lines = [
      '## Custom tools declared for this profile',
      '',
      'PowerShell templates with typed parameters. Read the linked document before',
      'calling one you have not used in this session.',
      '',
    ]
    for (const tool of tools) {
      const summary = tool.description.replace(/\s+/g, ' ').slice(0, SUMMARY_LIMIT)
      lines.push(`- \`${tool.name}\` — ${summary} (doc: ${tool.doc})`)
    }
    return lines.join('\n')
  }

  disposeAll() {
    for (const name of [...this.#disposers.keys()]) this.#uninstall(name)
  }
}
