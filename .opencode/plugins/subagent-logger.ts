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
