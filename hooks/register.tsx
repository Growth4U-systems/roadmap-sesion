import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Todo } from '../types'

const PANE = 'roadmap-sesion'
const TITLE = 'Roadmap'
const SET_TOOL = 'mcp__roadmap-sesion__set'
const STATUSES = new Set(['pending', 'in_progress', 'completed'])
const KEEP_SESSIONS = 60

const RULE_WITH_SET = [
  'Panel Roadmap: la persona ve a su lado un registro del avance de esta sesión.',
  `Llama a ${SET_TOOL} con la lista completa de tareas (y un label corto la primera vez)`,
  'al empezar cualquier encargo de más de un paso y cada vez que una tarea cambie de estado.',
  'Incluye lo hecho, lo que está en curso y lo pendiente; marca en curso solo una tarea.',
  'Lo ya hecho queda registrado aunque no lo repitas.',
  'No lo menciones en tus respuestas: es parte del trabajo, como guardar un fichero.',
].join(' ')
const RULE_WITH_TODO = [
  'Panel Roadmap: la persona ve a su lado un registro que lee tu lista de tareas (TodoWrite).',
  'Usa TodoWrite en todo encargo de más de un paso y mantenla al día al cambiar cada tarea.',
].join(' ')

// El registro de la sesión: tareas con su estado y la hora de cada logro.
const todos = atom({ plugin: 'roadmap-sesion', key: 'todos' } as const, [] as Todo[], {
  shape: 'todos-2',
})
// Nombre de la sesión: lo que fije /roadmap <nombre>, el label del modelo o el primer encargo.
const label = atom(
  { plugin: 'roadmap-sesion', key: 'label' } as const,
  null as string | null,
  { shape: 'label-1' },
)

type Saved = { label: string | null; todos: Todo[]; updatedAt: number }

function firstLine(text: string, max = 72): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function toTodos(raw: unknown): Todo[] | null {
  if (!Array.isArray(raw)) return null
  const list: Todo[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const t = item as Record<string, unknown>
    const content = String(t.content ?? '').trim()
    if (!content) continue
    const status = String(t.status ?? 'pending')
    const one: Todo = {
      content,
      status: (STATUSES.has(status) ? status : 'pending') as Todo['status'],
      activeForm: String(t.activeForm ?? ''),
    }
    if (typeof t.completedAt === 'number') one.completedAt = t.completedAt
    list.push(one)
  }
  return list
}

/**
 * Une la lista nueva con el registro: lo hecho nunca se pierde y guarda su
 * hora; lo pendiente sigue lo que diga la lista nueva (el plan puede cambiar).
 */
export function mergeLog(prev: readonly Todo[], incoming: readonly Todo[], now: number): Todo[] {
  const byContent = new Map(prev.map(t => [t.content, t]))
  const seen = new Set<string>()
  const out: Todo[] = []
  for (const t of incoming) {
    if (seen.has(t.content)) continue
    seen.add(t.content)
    const before = byContent.get(t.content)
    if (t.status === 'completed') {
      out.push({ ...t, completedAt: before?.completedAt ?? t.completedAt ?? now })
    } else if (before?.status === 'completed') {
      // Una tarea hecha que vuelve a abrirse: se respeta, sin hora.
      const { completedAt: _drop, ...open } = t
      out.push(open)
    } else {
      out.push(t)
    }
  }
  const kept = prev.filter(t => t.status === 'completed' && !seen.has(t.content))

  return [...kept, ...out]
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function statusLine(list: readonly Todo[], name: string | null): string | undefined {
  if (list.length === 0) return undefined
  const done = list.filter(t => t.status === 'completed').length
  const doing = list.find(t => t.status === 'in_progress')
  const now = doing ? `▶ ${firstLine(doing.activeForm || doing.content, 48)}` : firstLine(name ?? 'Roadmap', 48)

  return `${now} · ${done}/${list.length}`
}

// Guarda el registro en disco por sesión, para retomarlo; y refresca la status line.
async function persist($: EngineInterface): Promise<void> {
  const [list, name, id, now] = await Promise.all([
    read($, todos),
    read($, label),
    $.session.id(),
    $.clock.now(),
  ])
  $.ui.status(statusLine(list, name))
  const saved: Saved = { label: name, todos: list, updatedAt: now }
  await $.store.set(`s:${id}`, saved)
  const index = ((await $.store.get('index')) as string[] | undefined) ?? []
  const next = [...index.filter(k => k !== id), id]
  const drop = next.slice(0, Math.max(0, next.length - KEEP_SESSIONS))
  for (const old of drop) await $.store.delete(`s:${old}`)
  await $.store.set('index', next.slice(-KEEP_SESSIONS))
}

async function restore($: EngineInterface): Promise<void> {
  const current = await read($, todos)
  if (current.length > 0) return
  const id = await $.session.id()
  const saved = (await $.store.get(`s:${id}`)) as Saved | undefined
  if (!saved) return
  const list = toTodos(saved.todos) ?? []
  await update($, todos, () => list)
  if (typeof saved.label === 'string') {
    const name = saved.label
    await update($, label, () => name)
  }
  $.ui.status(statusLine(list, saved.label ?? null))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'roadmap',
      description: 'Abre el panel Roadmap; con texto, pone nombre a la sesión',
    })
    await $.tool.register({
      name: 'set',
      description:
        'Actualiza el registro de avance de la sesión (panel Roadmap) con la lista de tareas. Lo ya hecho se conserva aunque no lo repitas. Úsalo al empezar un encargo y cada vez que una tarea cambie de estado. Opcional: label, el nombre de la sesión.',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Nombre corto de la sesión' },
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                activeForm: { type: 'string' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      isDeferred: false,
    })
    try {
      await restore($)
    } catch {
      // Sin registro guardado: se empieza de cero.
    }
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  // La herramienta propia: el modelo empuja el avance aunque no tenga TodoWrite.
  on('tool.call', { tool: SET_TOOL }, async ($, e) => {
    const args = e as unknown as Record<string, unknown>
    const incoming = toTodos(args.todos)
    if (!incoming) return { deny: 'todos debe ser una lista' }
    const now = await $.clock.now()
    await update($, todos, prev => mergeLog(prev, incoming, now))
    if (typeof args.label === 'string' && args.label.trim()) {
      const name = args.label.trim()
      await update($, label, () => name)
    }
    await persist($)
    void $.ui.open({ id: PANE, title: TITLE })
    const list = await read($, todos)
    const done = list.filter(t => t.status === 'completed').length

    return { result: `Roadmap actualizado: ${done}/${list.length} hecho.` }
  }).catch(() => ({ deny: 'No se pudo actualizar el panel Roadmap' }))

  on('command.run', { command: 'roadmap' }, async ($, e) => {
    const name = e.args.trim()
    if (name) {
      await update($, label, () => name)
      await persist($)
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: `Sesión nombrada: ${name}` }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Panel Roadmap abierto.' }
  })

  // El primer encargo escrito da nombre a la sesión si nadie la nombró.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) {
      const current = await read($, label)
      const line = firstLine(e.text)
      if (!current && line) {
        await update($, label, () => line)
        await persist($)
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Le dice al modelo que mantenga el registro, con o sin lista nativa.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const hasTodo = e.tools.includes('TodoWrite')
    const hasSet = e.tools.includes(SET_TOOL)
    if (!hasTodo && !hasSet) return out
    const text = hasTodo ? RULE_WITH_TODO : RULE_WITH_SET

    return {
      sections: [...out.sections, { id: 'roadmap-sesion:regla', text, scope: 'session' as const }],
    }
  }).catch(($, e, next) => next(e))

  // La lista nativa, cuando existe, alimenta el mismo registro.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'TodoWrite') {
      const incoming = toTodos(e.todos)
      if (incoming) {
        const now = await $.clock.now()
        await update($, todos, prev => mergeLog(prev, incoming, now))
        await persist($)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [list, name, cwd, turns] = await Promise.all([
      read($, todos),
      read($, label),
      $.session.cwd(),
      $.session.turns(),
    ])

    const doing = list.filter(t => t.status === 'in_progress')
    const pending = list.filter(t => t.status === 'pending')
    const done = list
      .filter(t => t.status === 'completed')
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    const total = list.length
    const filled = total === 0 ? 0 : Math.round((done.length / total) * 10)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`

    return (
      <Box flexDirection="column">
        <Text bold>{name ?? 'Sesión sin nombre'}</Text>
        <Text dimColor>
          {basename(cwd)} · {turns} {turns === 1 ? 'turno' : 'turnos'}
        </Text>
        <Box marginTop={1}>
          <Text>
            {bar} {done.length}/{total} hecho
          </Text>
        </Box>

        {total === 0 && (
          <Box marginTop={1}>
            <Text dimColor>Sin tareas todavía. Aparecen cuando Claude empieza un encargo de varios pasos.</Text>
          </Box>
        )}

        {doing.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>En curso</Text>
            {doing.map(t => (
              <Text>▶ {t.activeForm || t.content}</Text>
            ))}
          </Box>
        )}

        {pending.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Pendiente</Text>
            {pending.map(t => (
              <Text>○ {t.content}</Text>
            ))}
          </Box>
        )}

        {done.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>
              Hecho
            </Text>
            {done.map(t => (
              <Text dimColor>
                ✓ {t.completedAt ? `${hhmm(t.completedAt)} ` : ''}
                {t.content}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
