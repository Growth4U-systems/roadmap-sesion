import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'roadmap-sesion',
  component: 'Pane',
  requestId: 'roadmap-sesion',
  props: {
    title: 'Roadmap',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SET = 'mcp__roadmap-sesion__set'

// Lo que el motor contestaría debajo del mod.
function world(on: On, opts: { store?: Record<string, unknown>; id?: string; guardado?: Record<string, unknown> } = {}) {
  const status: Array<string | undefined> = []
  on('session.cwd', () => ({ value: '/home/dev/mi-app' }))
  on('session.turns', () => ({ value: 2 }))
  on('session.id', () => ({ value: opts.id ?? 'sesion-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    status.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'roadmap' } }))
  on('tool.register', () => ({ value: { tool: SET } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  if (opts.guardado) {
    // Store a mano, para poder leer lo que el mod escribe.
    const g = opts.guardado
    on('store.get', (_, e) => ({ value: g[(e as { key: string }).key] }))
    on('store.set', (_, e) => {
      const { key, value } = e as { key: string; value: unknown }
      g[key] = value
      return { value: undefined }
    })
    on('store.delete', (_, e) => {
      delete g[(e as { key: string }).key]
      return { value: undefined }
    })
  } else {
    mock.store(on, opts.store)
  }
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 9, 0) })

  return { clock, status }
}

test('el panel enseña nombre, en curso, pendiente y hecho en cada superficie', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })
  await $.prompt.submit({ text: 'Implementa el checkout con pagos y facturas\nmás detalle' })
  await $.tool.call({
    tool: SET,
    todos: [
      { content: 'Catálogo', status: 'completed' },
      { content: 'Presupuesto', status: 'in_progress', activeForm: 'Haciendo presupuesto' },
      { content: 'Cuentas conectadas', status: 'pending' },
    ],
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /checkout/ }))?.text).toBe(
      'Implementa el checkout con pagos y facturas',
    )
    expect((await ui.find({ type: 'Text', text: /mi-app/ }))?.text).toBe('mi-app · 2 turnos')
    expect((await ui.find({ type: 'Text', text: /hecho/ }))?.text).toBe('███░░░░░░░ 1/3 hecho')
    expect((await ui.find({ type: 'Text', text: /▶/ }))?.text).toBe('▶ Haciendo presupuesto')
    expect((await ui.find({ type: 'Text', text: /○/ }))?.text).toBe('○ Cuentas conectadas')
    expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toMatch(/^✓ \d\d:\d\d Catálogo$/)
    await ui.unmount()
  }
})

test('lo hecho no se pierde aunque la lista nueva no lo traiga, y guarda su hora', async ($, on) => {
  const { clock } = world(on)
  await $.tool.call({ tool: SET, todos: [{ content: 'PR integrado', status: 'completed' }] })
  await clock.advance(30 * 60 * 1000)
  await $.tool.call({
    tool: SET,
    todos: [
      { content: 'PR integrado', status: 'completed' },
      { content: 'Mod roadmap', status: 'completed' },
      { content: 'Publicar', status: 'pending' },
    ],
  })
  // Lista nueva que ya no repite lo hecho.
  await $.tool.call({ tool: SET, todos: [{ content: 'Publicar', status: 'in_progress' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /hecho/ }))?.text).toBe('███████░░░ 2/3 hecho')
  const first = (await ui.find({ type: 'Text', text: /PR integrado/ }))?.text ?? ''
  const second = (await ui.find({ type: 'Text', text: /Mod roadmap/ }))?.text ?? ''
  expect(first).toMatch(/^✓ \d\d:\d\d PR integrado$/)
  expect(second).toMatch(/^✓ \d\d:\d\d Mod roadmap$/)
  // La primera conserva su hora original: media hora antes que la segunda.
  expect(first.slice(2, 7)).not.toBe(second.slice(2, 7))
  await ui.unmount()
})

test('el registro sobrevive al retomar la sesión', async ($, on) => {
  world(on, {
    id: 'sesion-vieja',
    store: {
      'id-ignorado': 1,
      's:sesion-vieja': {
        label: 'Migración a Postgres',
        todos: [
          { content: 'Esquema', status: 'completed', activeForm: '', completedAt: Date.UTC(2026, 9, 26, 15, 5) },
          { content: 'Datos', status: 'pending', activeForm: '' },
        ],
        updatedAt: 0,
      },
    },
  })
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Migración/ }))?.text).toBe('Migración a Postgres')
  expect((await ui.find({ type: 'Text', text: /○/ }))?.text).toBe('○ Datos')
  expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toMatch(/Esquema$/)
  await ui.unmount()
})

test('lo hecho va de lo más nuevo a lo más viejo', async ($, on) => {
  world(on, {
    id: 'sesion-orden',
    store: {
      's:sesion-orden': {
        label: 'Orden',
        todos: [
          { content: 'Primero', status: 'completed', activeForm: '', completedAt: Date.UTC(2026, 9, 26, 9, 0) },
          { content: 'Último', status: 'completed', activeForm: '', completedAt: Date.UTC(2026, 9, 26, 11, 0) },
        ],
        updatedAt: 0,
      },
    },
  })
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toMatch(/Último$/)
  await ui.unmount()
})

test('la status line enseña lo que está en curso y el avance', async ($, on) => {
  const { status } = world(on)
  await $.tool.call({
    tool: SET,
    label: 'Checkout',
    todos: [
      { content: 'Pagos', status: 'completed' },
      { content: 'Facturas', status: 'in_progress', activeForm: 'Generando facturas' },
    ],
  })
  expect(status.at(-1)).toBe('▶ Generando facturas · 1/2')
})

test('/roadmap <nombre> renombra la sesión', async ($, on) => {
  world(on)
  const out = await $.command.run({ command: 'roadmap', args: 'Migración a Postgres', origin: 'composer' })
  expect(out?.text).toBe('Sesión nombrada: Migración a Postgres')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Migración/ }))?.text).toBe('Migración a Postgres')
  await ui.unmount()
})

test('un valor de una versión anterior se descarta', async ($, on) => {
  world(on)
  on('state.get', () => ({ value: { value: [{ content: 'vieja' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Sin tareas/ }))?.text).toMatch(/Sin tareas todavía/)
  await ui.unmount()
})

test('la regla entra en el prompt solo si hay herramienta para cumplirla', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  const base = { model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [] } as const

  const sinNada = await $.prompt.compose({ ...base, tools: ['Bash'] })
  expect(sinNada.sections.length).toBe(1)

  const conSet = await $.prompt.compose({ ...base, tools: ['Bash', SET] })
  expect(conSet.sections.at(-1)?.id).toBe('roadmap-sesion:regla')
  expect(conSet.sections.at(-1)?.text).toMatch(/mcp__roadmap-sesion__set/)

  const conTodo = await $.prompt.compose({ ...base, tools: ['TodoWrite', SET] })
  expect(conTodo.sections.at(-1)?.text).toMatch(/TodoWrite/)
})

test('set guarda objetivo y éxito, los pinta y los persiste', async ($, on) => {
  const guardado: Record<string, unknown> = {}
  world(on, { guardado })
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })
  const out = await $.tool.call({ tool: SET, objetivo: 'Que Treg cobre', exito: 'Factura emitida', todos: [] })
  expect(String((out as { result?: unknown })?.result ?? '')).toMatch(/Objetivo guardado/)

  const saved = guardado['s:sesion-1'] as { objetivo?: string; exito?: string }
  expect(saved.objetivo).toBe('Que Treg cobre')
  expect(saved.exito).toBe('Factura emitida')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Objetivo/ }))?.text).toBe('Objetivo: Que Treg cobre')
  expect((await ui.find({ type: 'Text', text: /Éxito/ }))?.text).toBe('Éxito: Factura emitida')
  await ui.unmount()
})

test('restore recupera objetivo y éxito al arrancar', async ($, on) => {
  world(on, {
    id: 'sesion-vieja',
    store: {
      's:sesion-vieja': {
        label: 'Treg',
        objetivo: 'Que Treg cobre',
        exito: 'Factura emitida',
        todos: [{ content: 'Datos', status: 'pending', activeForm: '' }],
        updatedAt: 0,
      },
    },
  })
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Objetivo/ }))?.text).toBe('Objetivo: Que Treg cobre')
  expect((await ui.find({ type: 'Text', text: /Éxito/ }))?.text).toBe('Éxito: Factura emitida')
  await ui.unmount()
})

test('set sin tareas ni objetivo se rechaza', async ($, on) => {
  world(on)
  const out = await $.tool.call({ tool: SET })
  expect(String((out as { deny?: unknown })?.deny ?? '')).toMatch(/todos/)
})

const BASE_COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [] } as const

async function pideObjetivo($: Parameters<Parameters<typeof test>[1]>[0]): Promise<boolean> {
  const out = await $.prompt.compose({ ...BASE_COMPOSE, tools: ['Bash', SET] })
  return out.sections.some(s => s.id === 'roadmap-sesion:objetivo')
}

test('pide objetivo al tercer encargo sin issue y deja de pedirlo cuando existe', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  await $.prompt.submit({ text: 'Mira cómo va el deck' })
  expect(await pideObjetivo($)).toBe(false)
  await $.prompt.submit({ text: 'Ahora cambia el color' })
  expect(await pideObjetivo($)).toBe(false)
  await $.prompt.submit({ text: 'Y añade una slide' })
  expect(await pideObjetivo($)).toBe(true)
  const out = await $.prompt.compose({ ...BASE_COMPOSE, tools: ['Bash', SET] })
  expect(out.sections.find(s => s.id === 'roadmap-sesion:objetivo')?.text).toMatch(/qué quiere lograr/)

  await $.tool.call({ tool: SET, objetivo: 'Deck de Monzo listo', exito: 'Alfonso lo aprueba' })
  expect(await pideObjetivo($)).toBe(false)
})

test('no pide objetivo si algún encargo cita un issue ni sin la herramienta', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  await $.prompt.submit({ text: 'arregla SAN-12' })
  await $.prompt.submit({ text: 'sigue' })
  await $.prompt.submit({ text: 'y sigue' })
  expect(await pideObjetivo($)).toBe(false)

  const sinSet = await $.prompt.compose({ ...BASE_COMPOSE, tools: ['Bash'] })
  expect(sinSet.sections.some(s => s.id === 'roadmap-sesion:objetivo')).toBe(false)
})

test('un issue citado tarde tampoco vuelve a pedir el objetivo', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  for (const t of ['a', 'b', 'c']) await $.prompt.submit({ text: t })
  expect(await pideObjetivo($)).toBe(true)
  await $.prompt.submit({ text: 'esto es PAN-3' })
  expect(await pideObjetivo($)).toBe(false)
})

test('no pide objetivo en sesiones no interactivas', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'terminal', isInteractive: false })
  for (const t of ['a', 'b', 'c']) await $.prompt.submit({ text: t })
  expect(await pideObjetivo($)).toBe(false)
})

test('deja de pedir el objetivo tras tres veces o si la persona dice que no aplica', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })
  for (const t of ['a', 'b', 'c']) await $.prompt.submit({ text: t })
  expect(await pideObjetivo($)).toBe(true)
  expect(await pideObjetivo($)).toBe(true) // el mismo encargo, lo que haga falta
  await $.prompt.submit({ text: 'd' })
  expect(await pideObjetivo($)).toBe(true)
  await $.prompt.submit({ text: 'e' })
  expect(await pideObjetivo($)).toBe(true)
  await $.prompt.submit({ text: 'f' })
  expect(await pideObjetivo($)).toBe(false) // tres encargos pidiéndolo y basta
})

test('set con objetivo "no aplica" apaga la pregunta', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  world(on)
  await $.session.start({ cwd: '/home/dev/mi-app', surface: 'vscode', isInteractive: true })
  for (const t of ['a', 'b', 'c']) await $.prompt.submit({ text: t })
  expect(await pideObjetivo($)).toBe(true)
  await $.tool.call({ tool: SET, objetivo: 'no aplica' })
  expect(await pideObjetivo($)).toBe(false)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Objetivo/ })).toBeUndefined()
  await ui.unmount()
})
