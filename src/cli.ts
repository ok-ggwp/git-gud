import { GudError } from './git.ts'
import * as agents from './commands/agents.ts'
import * as review from './commands/review.ts'

const COMMANDS: Record<string, { usage: string; run: (argv: string[]) => Promise<number> }> = { review, agents }

function help(): string {
  return 'usage: git gud <command> [options]\n\n' +
    Object.values(COMMANDS)
      .map((c) => {
        const [synopsis, desc] = c.usage.split(/ {3}/)
        return `  ${synopsis}\n      ${desc}`
      })
      .join('\n')
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(help())
    return 0
  }
  const command = COMMANDS[cmd]
  if (!command) {
    console.error(`unknown command "${cmd}"\n\n${help()}`)
    return 2
  }
  try {
    return await command.run(rest)
  } catch (err) {
    if (err instanceof GudError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`error: ${(err as Error).message}`)
      return 1
    }
    throw err
  }
}
