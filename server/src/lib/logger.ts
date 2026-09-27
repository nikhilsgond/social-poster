// server/src/lib/logger.ts
// Simple backend logger.
// Supports: info, warn, error.
// NEVER logs credentials or secrets.

type LogLevel = "info" | "warn" | "error";

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🔴",
};

let CURRENT_LEVEL_INDEX = 0;
const LEVELS: LogLevel[] = ["info", "warn", "error"];

export function setLogLevel(level: LogLevel) {
  const idx = LEVELS.indexOf(level);
  if (idx >= 0) CURRENT_LEVEL_INDEX = idx;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= CURRENT_LEVEL_INDEX;
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
  if (!shouldLog("info")) return;
  const metaStr = meta ? ` ${JSON.stringify(sanitizeMeta(meta))}` : "";
  console.log(`[INFO] ${message}${metaStr}`);
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
  if (!shouldLog("warn")) return;
  const metaStr = meta ? ` ${JSON.stringify(sanitizeMeta(meta))}` : "";
  console.warn(`[WARN] ${message}${metaStr}`);
}

export function logError(message: string, meta?: Record<string, unknown>) {
  if (!shouldLog("error")) return;
  const metaStr = meta ? ` ${JSON.stringify(sanitizeMeta(meta))}` : "";
  console.error(`[ERROR] ${message}${metaStr}`);
}

// Remove any potentially sensitive fields from logged metadata
function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ["service_role", "api_secret", "apiKey", "password", "token", "secret"];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (sensitive.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
