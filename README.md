# Mi Primer Plugin de OpenCode — Guía Rápida

> Resumen práctico para crear un plugin local en OpenCode que loggea el ciclo de vida de subagentes.

---

## ¿Qué es un plugin de OpenCode?

Un plugin es un archivo JavaScript o TypeScript que OpenCode carga automáticamente al inicio.
Permite "engancharse" a eventos internos del agente: interceptar herramientas, reaccionar a
sesiones, modificar comportamientos, etc.

---

## Estructura de carpetas del proyecto

```
C:\_Tony\_OpenCode\MiPrimerPluginDeOpenCode\
│
├── README.md                    ← este archivo
└── .opencode/
    └── plugins/                ← directorio plural, no singular
        └── subagent-logger.ts  ← el plugin
```

Para que OpenCode lo use, el archivo debe estar en una de estas ubicaciones:

| Alcance | Ruta |
|---------|------|
| **Solo este proyecto** | `.opencode/plugins/subagent-logger.ts` |
| **Todos los proyectos** | `%USERPROFILE%\.config\opencode\plugins\subagent-logger.ts` |

---

## Concepto clave: ¿cómo funciona un subagente?

Cuando el agente principal necesita ayuda, invoca el tool interno `task`.
Ese tool crea una **sesión hija** (child session) con su propio contexto y agente especializado.

```
Agente principal (build / plan)
    │
    └── llama al tool "task"
            │
            └── crea sesión hija → subagente (explore / general / custom)
                    │
                    └── trabaja... → session.idle (terminó)
```

---

## Los hooks que usamos

### 1. `tool.execute.before` — justo antes de lanzar el subagente

```typescript
"tool.execute.before": async (input, output) => {
  if (input.tool !== "task") return
  console.log("Subagente lanzado:", output.args?.agent)
}
```

### 2. `tool.execute.after` — después de que el tool task terminó

```typescript
"tool.execute.after": async (input) => {
  if (input.tool !== "task") return
  // Acá ya tenemos el sessionID de la sesión hija en el resultado
}
```

### 3. `event` con `session.created` — cuando OpenCode crea la sesión hija

```typescript
event: async ({ event }) => {
  if (event.type === "session.created") {
    const ev = event as any
    if (!ev.properties?.parentID) return  // solo sesiones hijas
    console.log("Sesión hija creada:", ev.properties.sessionID)
  }
}
```

### 4. `event` con `session.idle` — cuando el subagente terminó de responder

```typescript
event: async ({ event }) => {
  if (event.type === "session.idle") {
    console.log("Subagente finalizado:", (event as any).properties?.sessionID)
  }
}
```

---

## El plugin completo: `subagent-logger.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync } from "fs"
import { join } from "path"

const LOG_FILE = join(process.cwd(), ".opencode", "subagent.log")

function timestamp(): string {
  return new Date().toISOString()
}

function writeLog(level: "INFO" | "WARN", message: string, data?: object) {
  const line = JSON.stringify({ ts: timestamp(), level, message, ...data })
  console.log(`[subagent-logger] ${message}`, data ?? "")
  try {
    appendFileSync(LOG_FILE, line + "\n")
  } catch {
    // Si no puede escribir, no rompe el plugin
  }
}

interface SubagentRecord {
  sessionID: string
  parentSessionID?: string
  agentName?: string
  description?: string
  startedAt: string
}

const activeSubagents = new Map<string, SubagentRecord>()

export const SubagentLoggerPlugin: Plugin = async ({ client }) => {
  writeLog("INFO", "SubagentLoggerPlugin cargado ✅")

  return {

    // ── Antes de lanzar el subagente ────────────────────────────────────
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return
      writeLog("INFO", "🚀 Subagente lanzado", {
        agent:       output.args?.agent       ?? "(sin especificar)",
        description: output.args?.description ?? "(sin descripción)",
        parentSessionID: (input as any).sessionID,
      })
    },

    // ── Después de lanzar el subagente (registramos sessionID hija) ─────
    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return
      const childSessionID = (input as any).output?.sessionID
                          ?? (input as any).result?.sessionID
                          ?? `task-${Date.now()}`
      const record: SubagentRecord = {
        sessionID:       childSessionID,
        parentSessionID: (input as any).sessionID,
        agentName:       (input.args?.agent       as string) ?? "(desconocido)",
        description:     (input.args?.description as string) ?? "",
        startedAt:       timestamp(),
      }
      activeSubagents.set(childSessionID, record)
      writeLog("INFO", "📋 Sesión registrada", record)
    },

    // ── Eventos de sesión ────────────────────────────────────────────────
    event: async ({ event }) => {
      const ev = event as any

      if (ev.type === "session.created") {
        const sessionID = ev.properties?.sessionID ?? ev.session_id ?? ev.sessionID
        const parentID  = ev.properties?.parentID  ?? ev.parentID
        if (!parentID) return
        writeLog("INFO", "🟢 Sesión hija creada", { sessionID, parentID })
        if (!activeSubagents.has(sessionID)) {
          activeSubagents.set(sessionID, {
            sessionID,
            parentSessionID: parentID,
            startedAt: timestamp(),
          })
        }
      }

      if (ev.type === "session.idle") {
        const sessionID = ev.properties?.sessionID ?? ev.session_id ?? ev.sessionID
        const record    = activeSubagents.get(sessionID)
        if (!record) return
        const duracionMs = new Date().getTime() - new Date(record.startedAt).getTime()
        writeLog("INFO", "🏁 Subagente finalizado", {
          sessionID,
          agentName:  record.agentName,
          duracionSeg: (duracionMs / 1000).toFixed(1) + "s",
        })
        activeSubagents.delete(sessionID)
      }

      if (ev.type === "session.deleted") {
        const sessionID = ev.properties?.sessionID ?? ev.session_id ?? ev.sessionID
        if (activeSubagents.has(sessionID)) {
          writeLog("WARN", "⚠️ Sesión eliminada sin completar", { sessionID })
          activeSubagents.delete(sessionID)
        }
      }
    },
  }
}
```

---

## Cómo instalar el plugin (paso a paso en Windows)

### Opción A — Solo para el proyecto actual

1. Abrí una terminal en la raíz de tu proyecto
2. Creá la carpeta si no existe:
   ```cmd
   mkdir .opencode\plugins
   ```
3. Copiá el archivo:
   ```cmd
   copy "C:\_Tony\_OpenCode\MiPrimerPluginDeOpenCode\.opencode\plugins\subagent-logger.ts" ".opencode\plugins\subagent-logger.ts"
   ```
4. Reiniciá OpenCode — el plugin se carga automáticamente.

### Opción B — Global (todos los proyectos)

```cmd
mkdir "%USERPROFILE%\.config\opencode\plugins"
copy "C:\_Tony\_OpenCode\MiPrimerPluginDeOpenCode\.opencode\plugins\subagent-logger.ts" "%USERPROFILE%\.config\opencode\plugins\subagent-logger.ts"
```

---

## Dónde queda el log

El archivo de log se genera en la carpeta `.opencode/` del **proyecto donde corrés OpenCode**:

```
tu-proyecto/
└── .opencode/
    └── subagent.log   ← acá se guardan los registros
```

### Ejemplo de contenido del log

```jsonc
{"ts":"2026-03-31T10:00:01.123Z","level":"INFO","message":"SubagentLoggerPlugin cargado ✅"}
{"ts":"2026-03-31T10:00:05.200Z","level":"INFO","message":"🚀 Subagente lanzado","agent":"explore","description":"Buscar patrones en el codebase"}
{"ts":"2026-03-31T10:00:05.500Z","level":"INFO","message":"🟢 Sesión hija creada","sessionID":"ses_abc123","parentID":"ses_xyz999"}
{"ts":"2026-03-31T10:00:18.900Z","level":"INFO","message":"🏁 Subagente finalizado","agentName":"explore","duracionSeg":"13.4s"}
```

---

## Errores comunes y soluciones

| Problema | Causa | Solución |
|----------|-------|----------|
| El plugin no carga | Error de TypeScript o de sintaxis | OpenCode no muestra errores de plugins silenciosamente. Probá con una versión simplificada primero |
| No aparecen logs del tool `task` | El agente no usa subagentes | Probá pidiendo algo que requiera investigación o exploración |
| `session.idle` no dispara | Puede haber un bug en la versión de OpenCode | Verificá que el hook `event` esté siendo llamado con un log de debug |
| El archivo `.log` no se crea | Error al escribir | Verificá que el directorio `.opencode/` exista |

---

## Debugging del plugin

Si el plugin no funciona, seguí estos pasos:

### Paso 1: Probá la versión mínima

Creá un archivo de prueba mínimo para verificar que OpenCode carga plugins:

```typescript
// .opencode/plugins/test-plugin.ts
export const TestPlugin = async (ctx: any) => {
  console.log("🔧 [test] Plugin inicializado")
  return {
    event: async ({ event }: any) => {
      console.log("📡 [test] Evento:", event.type)
    }
  }
}
```

Si ves los logs en la consola de OpenCode, el sistema de plugins funciona.

### Paso 2: Verificá los logs de OpenCode

Al iniciar OpenCode, buscá mensajes relacionados con plugins. Si hay errores de sintaxis, van a aparecer ahí.

### Paso 3: Usá `ctx` para acceder al contexto

En lugar de depender solo de `client`, el contexto tiene más propiedades útiles:

```typescript
export const MyPlugin = async (ctx) => {
  // ctx tiene: project, client, $, directory, worktree
  console.log("📁 Directorio:", ctx.directory)
  console.log("📂 Working tree:", ctx.worktree)
  return { /* hooks */ }
}
```

---

## Links útiles

- Documentación oficial de plugins: https://opencode.ai/docs/plugins/
- Documentación de agentes: https://opencode.ai/docs/agents/
- Referencia de la API del plugin: https://docs.opencode.ai/plugin

---

*Generado el 2026-03-31 — Plugin versión inicial*
