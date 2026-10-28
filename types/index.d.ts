export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
  /** Cuándo pasó a hecha, en ms desde epoch; solo en las completadas. */
  completedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'roadmap-sesion': {
      todos: Shaped<Todo[]>
      label: Shaped<string | null>
      objetivo: Shaped<string | null>
      exito: Shaped<string | null>
    }
  }
}
