export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
  /** Cuándo pasó a hecha, en ms desde epoch; solo en las completadas. */
  completedAt?: number
}

/** Cuántos encargos lleva la sesión, si alguno cita un issue de Linear, si es interactiva y cuántas veces se pidió el objetivo. */
export type Encargos = { n: number; citaIssue: boolean; interactiva: boolean; pedidas: number }

declare module 'claude-code' {
  interface PluginState {
    'roadmap-sesion': {
      todos: Shaped<Todo[]>
      label: Shaped<string | null>
      objetivo: Shaped<string | null>
      exito: Shaped<string | null>
      encargos: Shaped<Encargos>
    }
  }
}
