import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { basename } from 'node:path'
import { GudError } from './git.ts'

export const SEPARATOR_TEXT = '---\n\n# Material under review'
const MAX_FILE = 128 * 1024
const MAX_TOTAL = 256 * 1024

// An escape sequence ends at its terminator or not at all: an unterminated one
// loses only its introducer, never the lines after it (evidence is not truncated).
// Text from a file is untrusted: no terminal escapes (OSC 52 would write the
// reader's clipboard), no control characters, no bidi overrides that make
// text read differently from how it is ordered.
export function cleanText(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[PX^_][^\x1b\n]*\x1b\\/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r\n?/g, '\n')
    // plus the invisible format characters git-gloss's plain() strips (ZWNJ/ZWJ stay: they hide nothing and valid text needs them)
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b\u200e\u200f\u061c\u180e\u2060-\u2064\ufeff\u{e0000}-\u{e007f}]/gu, '')
}

// A label or path from the command line is untrusted text too: one line, no control characters.
function cleanLabel(s: string): string {
  return cleanText(s).replace(/\s+/g, ' ').trim()
}

const cannot = (file: string, err: unknown) => new GudError(`--evidence ${cleanLabel(file)}: cannot read it (${(err as { code?: string }).code ?? err})`)

// At most `limit`+1 bytes are ever read, so /dev/zero or a huge file can't
// hang or exhaust memory.
function readBounded(file: string, limit: number): Buffer {
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (err) {
    throw cannot(file, err)
  }
  try {
    const st = fstatSync(fd)
    if (st.isDirectory()) throw new GudError(`--evidence ${cleanLabel(file)}: is a directory, not a file`)
    if (st.isFIFO() || st.isSocket()) throw new GudError(`--evidence ${cleanLabel(file)}: is not a regular file; write the text to a regular file first (process substitution and pipes are not accepted)`)
    const buf = Buffer.alloc(limit + 1)
    let total = 0
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null)
      if (n === 0) break
      total += n
    }
    return buf.subarray(0, total)
  } catch (err) {
    throw err instanceof GudError ? err : cannot(file, err)
  } finally {
    closeSync(fd)
  }
}

export type Evidence = { name: string; text: string }

// Reads the --evidence files; refuses, never truncates.
export function readEvidence(files: string[]): Evidence[] {
  let total = 0
  return files.map((file) => {
    const buf = readBounded(file, MAX_FILE)
    if (buf.length > MAX_FILE) throw new GudError(`--evidence ${cleanLabel(file)}: over ${MAX_FILE / 1024} KiB; give the reviewer a shorter excerpt`)
    total += buf.length
    if (total > MAX_TOTAL) throw new GudError(`--evidence ${cleanLabel(file)}: the evidence files together are over ${MAX_TOTAL / 1024} KiB (--evidence is limited so the prompt stays readable)`)
    const text = cleanText(buf.toString('utf8')).trimEnd()
    if (buf.includes(0)) throw new GudError(`--evidence ${cleanLabel(file)}: contains NUL bytes; it is not text`)
    if (text.includes(SEPARATOR_TEXT)) throw new GudError(`--evidence ${cleanLabel(file)}: contains the review prompt's "Material under review" separator; it could forge the prompt's structure`)
    return { name: cleanLabel(basename(file)).slice(0, 80).trim() || 'evidence', text }
  })
}
