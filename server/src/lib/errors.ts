// server/src/lib/errors.ts
// Centralized error handling for the backend.
// Distinguishes configuration, database, and publisher errors.
// Never exposes secrets in error messages.

export class ConfigError extends Error {
  constructor(message: string) {
    super(`[CONFIG] ${message}`);
    this.name = "ConfigError";
  }
}

export class DatabaseError extends Error {
  constructor(message: string, original?: Error) {
    super(`[DATABASE] ${message}`);
    this.name = "DatabaseError";
    if (original) console.error(`Original error: ${original.message}`);
  }
}

export class PublisherError extends Error {
  constructor(message: string, public readonly platform?: string) {
    super(`[PUBLISHER] ${message}`);
    this.name = "PublisherError";
  }
}

export function classifyError(err: unknown): Error {
  if (err instanceof ConfigError) return err;
  if (err instanceof DatabaseError) return err;
  if (err instanceof PublisherError) return err;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("supabase") || msg.includes("database") || msg.includes("relation") || msg.includes("permission")) {
      return new DatabaseError(err.message, err);
    }
    return new Error(err.message);
  }
  return new Error(String(err));
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    // Never expose secrets in error messages
    const safeMsg = err.message
      .replace(process.env.SUPABASE_SERVICE_ROLE_KEY || "", "[REDACTED]")
      .replace(process.env.CLOUDINARY_API_SECRET || "", "[REDACTED]");
    return safeMsg;
  }
  return String(err);
}
