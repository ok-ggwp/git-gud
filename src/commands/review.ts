import { parseArgs } from 'node:util'
import { git, gitTry, GudError, resolveTarget, type Target } from '../git.ts'
import { directText, parseAgent, resolveBin, runAgent, spec as specFor, which, type Access, type Agent } from '../agents.ts'
import { fenced, gloss, NoGloss, STAGES, stagePrompt, type Stage } from '../stages.ts'
import { createWorkspace, type Workspace } from '../workspace.ts'

export const usage = 'review [<commit> | <range> | wip] [--stage bugs,honesty,improve] [--agent <name>[:<model>]]... [--max <n>] [--browser] [--sandbox [--network | --allow-domain <d>]...] [--no-record] [--dry-run] [--keep]   review a change with coding agents, each in a disposable clone'

function preamble(agent: Agent, ws: Workspace, t: Target, access: Access): string {
  const what = t.kind === 'wip'
    ? 'a snapshot commit of the author\'s uncommitted work (HEAD is that snapshot; the changes are not committed in the real repository)'
    : t.kind === 'range' ? `the tip of the branch under review (${t.rev})` : 'the commit under review'
  const where = access.sandbox
    ? `You are running in a sandbox directory ${ws.dir} containing a disposable clone of the repository at ${ws.clone},
checked out at ${what}. ${agent.confinement(ws, access)}`
    : `The clone is checked out at ${what}. ${directText(ws, access)}`
  const config = [
    ws.removed.length ? (access.sandbox
      ? `All agent configuration files, the project's and the change's, were removed from the checkout so they could not configure you: ${ws.removed.join(' ')}.`
      : `The reviewed change added these agent configuration files; they were removed from the checkout so the change can't instruct its reviewer: ${ws.removed.join(' ')}.`) : '',
    ws.restored.length ? `The reviewed change edited these agent configuration files; they are restored to how they were before the change, so the change can't instruct its reviewer: ${ws.restored.join(' ')}.` : '',
  ].filter(Boolean)
  return `${where} Create scratch tests and throwaway git repos under ${ws.scratch}
and run them. To run the code under review, use the clone's own entry points, build and tests, not any globally installed copy.${config.length ? `

${config.join(' ')} Read the change's versions with git show HEAD:<path> if they matter to the review.` : ''}

Verify findings by running them where you can. In your report, mark each finding as **verified** (you ran something
that shows it) or **read** (from reading the code only).`
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      stage: { type: 'string' },
      agent: { type: 'string', multiple: true },
      max: { type: 'string' },
      sandbox: { type: 'boolean' },
      network: { type: 'boolean' },
      'allow-domain': { type: 'string', multiple: true },
      browser: { type: 'boolean' },
      record: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      keep: { type: 'boolean' },
    },
    // --no-sandbox, --no-network and --no-browser override the git config defaults.
    allowNegative: true,
  })
  const stages = (values.stage ?? STAGES.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
  for (const s of stages) if (!STAGES.includes(s as Stage)) throw new GudError(`unknown stage "${s}" (stages: ${STAGES.join(', ')})`)
  const agents = (values.agent ?? ['claude']).map(parseAgent)
  const max = Number(values.max ?? 5)
  if (!Number.isInteger(max) || max < 1) throw new GudError('--max takes a positive whole number')

  // Defaults from git config (gud.sandbox, gud.network, gud.browser), so
  // someone who always wants them sets them once; flags override for one run.
  const setting = (key: string) => gitTry(['config', '--type=bool', '--get', key])?.trim() === 'true'
  const access: Access = {
    sandbox: values.sandbox ?? setting('gud.sandbox'),
    network: values.network ?? setting('gud.network'),
    domains: values['allow-domain'] ?? [],
    browser: values.browser ?? setting('gud.browser'),
  }
  // Never silent about running unconfined.
  if (!access.sandbox) console.error('note: reviewers run with your own agent settings and permissions; for code you don\'t trust, add --sandbox')

  // Say when an access choice has no effect, rather than ignore it.
  if (!access.sandbox && (values.network !== undefined || access.domains.length)) {
    console.error('note: --network and --allow-domain apply to sandboxed reviews (--sandbox); without it, reviewers have the network your own sessions have')
  } else if (access.domains.length && access.network) console.error('note: --allow-domain has no effect with the network fully open (--network or gud.network)')
  else if (access.domains.length && agents.some(({ agent }) => agent.name !== 'claude')) {
    console.error('note: --allow-domain applies to Claude reviewers only; Codex and Cursor reach their model through an open network and are asked not to use it')
  }

  const repo = git(['rev-parse', '--show-toplevel']).trim()
  const target = resolveTarget(positionals[0] ?? 'HEAD')

  // Build every prompt before starting any agent, so a missing gloss or
  // git-gloss fails fast.
  const prompts: [Stage, string][] = []
  for (const stage of stages as Stage[]) {
    try {
      prompts.push([stage, stagePrompt(stage, target, repo, { max })])
    } catch (err) {
      if (!(err instanceof NoGloss)) throw err
      console.error(`skipping the ${stage} stage: ${err.message}`)
    }
  }
  if (!prompts.length) throw new GudError('nothing to review')

  // What the reviewers are about to see, so each finished review can be
  // recorded beside the glosses (git gloss reviews), saying what it covered.
  // --no-record skips it; a git-gloss without reviews only loses the record.
  // The stamp names the exact commits the clones are built from, so a branch
  // that moves meanwhile can't change what the record says was reviewed.
  let stamp: unknown = null
  if (values.record !== false && !values['dry-run']) {
    const exact = target.kind === 'range' ? `${target.base}..${target.sha}` : target.sha
    try {
      stamp = JSON.parse(gloss(['reviews', '--stamp', exact], repo))
    } catch (err) {
      // Recording is optional: any failure here costs only the record.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`note: reviews won't be recorded: ${/unknown command/.test(msg) ? 'this git-gloss is too old to record them' : msg}`)
    }
  }
  // A dry run shows the setup even for agents that aren't installed.
  const bins = new Map(agents.map(({ agent }) => [agent.name, values['dry-run'] ? which(agent.command) : resolveBin(agent)]))

  const runs = prompts.flatMap(([stage, prompt]) => agents.map(({ agent, model }) => ({ stage, prompt, agent, model })))
  const label = (r: (typeof runs)[number]) => `${r.stage} (${r.agent.name}${r.model ? `:${r.model}` : ''})`

  if (values['dry-run']) {
    for (const r of runs) {
      const ws = createWorkspace(repo, target, r.stage !== 'bugs', access.sandbox)
      try {
        const bin = bins.get(r.agent.name)
        const spec = bin ? specFor(r.agent, bin, ws, r.model, access) : null
        console.log(`===== ${label(r)} =====\n\nworkspace: ${ws.dir}\nhead: ${git(['rev-parse', 'HEAD'], { cwd: ws.clone }).trim()}\n` +
          `remotes: ${git(['remote'], { cwd: ws.clone }).trim().split('\n').filter(Boolean).length}\n` +
          `glosses: ${git(['for-each-ref', '--format=%(refname)', 'refs/notes/'], { cwd: ws.clone }).trim() || 'none'}\n` +
          `removed: ${ws.removed.join(' ') || 'none'}\nrestored: ${ws.restored.join(' ') || 'none'}\n` +
          `mode: ${access.sandbox ? 'sandboxed' : 'direct'}${spec ? `\ncwd: ${spec.cwd}` : ''}\ncommand: ${spec ? `${spec.cmd} ${spec.args.map((a) => JSON.stringify(a)).join(' ')}` : `(${r.agent.command} is not on PATH)`}\n\n` +
          `${preamble(r.agent, ws, target, access)}\n\n${r.prompt}\n`)
      } finally {
        if (!values.keep) ws.dispose()
      }
    }
    return 0
  }

  // Each run gets its own clone, so one reviewer's scratch edits can't
  // mislead another; the runs go in parallel.
  // On Ctrl-C the agents die with the terminal's signal; remove their sandboxes too.
  const live = new Set<Workspace>()
  const interrupted = () => {
    if (!values.keep) for (const ws of live) ws.dispose()
    process.exit(130)
  }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  const results = await Promise.all(runs.map(async (r) => {
    const ws = createWorkspace(repo, target, r.stage !== 'bugs', access.sandbox)
    live.add(ws)
    const started = Date.now()
    console.error(`${label(r)}: started`)
    try {
      const spec = specFor(r.agent, bins.get(r.agent.name)!, ws, r.model, access)
      const res = await runAgent(spec, ws, `${preamble(r.agent, ws, target, access)}\n\n${r.prompt}`)
      console.error(`${label(r)}: ${res.ok ? 'done' : 'failed'} after ${Math.round((Date.now() - started) / 1000)}s`)
      if (res.ok && res.output && stamp) {
        try {
          gloss(['reviews', '--record'], repo, JSON.stringify({
            stage: r.stage, agent: r.agent.name, model: r.model, mode: access.sandbox ? 'sandboxed' : 'direct',
            target: target.rev, findings: res.output, stamp,
          }))
        } catch (err) {
          if (!(err instanceof GudError)) throw err
          console.error(`${label(r)}: recording the review failed: ${err.message}`)
        }
      }
      return { r, ...res }
    } catch (err) {
      // Any error fails this run only, so the other reviews are still reported.
      const msg = err instanceof GudError ? err.message : String((err as Error)?.stack ?? err)
      console.error(`${label(r)}: ${msg}`)
      return { r, ok: false, output: '', log: msg }
    } finally {
      if (values.keep) console.error(`${label(r)}: workspace kept at ${ws.dir}`)
      else ws.dispose()
      live.delete(ws)
    }
  }))

  console.log(`# git gud review ${target.rev}\n`)
  for (const res of results) {
    console.log(`## ${label(res.r)}\n`)
    console.log(res.ok ? res.output || '(no output)' : `**The review failed.**\n\n${fenced('text', (res.log || res.output).slice(-4000))}`)
    console.log()
  }
  return results.every((res) => res.ok) ? 0 : 1
}
