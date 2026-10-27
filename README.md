# roadmap-sesion

Mod para Claude Code que lleva el registro de avance de cada sesión y lo deja siempre a la vista: un panel al lado del chat con el nombre de la sesión, una barra de progreso y las tareas en En curso, Pendiente y Hecho, cada logro con su hora. La status line muestra lo que está en curso y el avance (`▶ Generando facturas · 3/7`) aunque el panel esté cerrado.

*A Claude Code mod that keeps a progress log for each session, always visible: a side pane with what is in progress, pending and done (with times), plus a status line entry.*

## Cómo funciona

- Claude actualiza el registro solo: el mod le añade una instrucción para que lo haga al empezar cada encargo de varios pasos y cada vez que una tarea cambia de estado. Si la sesión tiene la lista de tareas nativa (TodoWrite), la usa; si no, usa la herramienta propia del mod.
- Lo hecho nunca se borra del registro, aunque Claude mande una lista nueva sin repetirlo.
- El registro se guarda por sesión y vuelve al retomarla.
- Funciona en terminal, en VS Code o Cursor y en la app de escritorio.

## Instalación

En el prompt de una sesión de Claude Code en terminal:

```
/plugin install roadmap-sesion --marketplace Growth4U-systems/roadmap-sesion
```

Desde una shell:

```
claude plugin install roadmap-sesion --marketplace Growth4U-systems/roadmap-sesion
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto a la caja del prompt, luego Plugins, Add marketplace con `Growth4U-systems/roadmap-sesion`, y Add plugin.

## Uso

- El panel «Roadmap» se abre solo al empezar la sesión.
- `/roadmap` lo vuelve a abrir.
- `/roadmap <nombre>` pone nombre a la sesión. Sin nombre, usa la primera línea del primer encargo.

## Coste

La instrucción ronda los 90 tokens por petición y cada actualización del registro unos 300.

## Feedback

Abierto a mejorarlo: abre un issue con lo que te falte.

Licencia MIT.
