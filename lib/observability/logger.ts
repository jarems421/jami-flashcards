import "server-only";

/**
 * Structured server logs.
 *
 * Every record is one JSON line, so the host's log search can filter by event,
 * route, or requestId instead of grepping prose. The AI pipeline is why this
 * exists: a single student request can span a streamed attempt, a model
 * fallback, and a non-streaming retry, and plain `console.error` leaves those
 * as three unrelated lines with nothing tying them to the same request.
 *
 * The record building is pure and separately exported, because the part worth
 * testing is redaction, not the write to stdout.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  /** Returns a logger carrying these fields plus everything already bound. */
  child: (bindings: LogFields) => Logger;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const RESERVED_KEYS = ["level", "event", "time"] as const;
const REDACTED = "[redacted]";
const MAX_STRING_LENGTH = 512;
const MAX_STACK_LENGTH = 2_000;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;

/**
 * Field names holding student work, prompt text, or credentials.
 *
 * Logging is the easiest place to leak a student's notes: the value is already
 * in scope and `{ front }` reads harmlessly at the call site. Matching on the
 * key name redacts those by construction instead of by everyone remembering.
 * Log a length, a count, or an id when you need to describe the value.
 *
 * Names are matched exactly (case-insensitively) rather than by substring, so
 * that `promptTokenCount` and `maxOutputTokens` — which are diagnostics worth
 * keeping — survive while `prompt` and `token` do not.
 */
const REDACTED_KEYS = new Set([
  // Credentials
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "accesstoken",
  "bearer",
  "cookie",
  "idtoken",
  "password",
  "secret",
  "token",
  // Model input and output
  "buffer",
  "content",
  "contents",
  "contenttext",
  "focus",
  "generated",
  "history",
  "instruction",
  "parts",
  "prompt",
  "prompts",
  "reply",
  "systeminstruction",
  "systemprompt",
  "userprompt",
  // Student-authored material
  "answer",
  "answertext",
  "back",
  "email",
  "front",
  "message",
  "name",
  "question",
  "questiontext",
  "solutiontext",
  "text",
  "title",
]);

function truncate(value: string, max: number) {
  return value.length <= max
    ? value
    : `${value.slice(0, max)}…(+${value.length - max})`;
}

/**
 * Unpacks a thrown value into fields worth searching on.
 *
 * `console.error("failed", error)` renders a bare object as `[object Object]`
 * and an Error without its status, which is exactly the detail needed to tell
 * a provider outage from a rate limit.
 */
function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: truncate(error.message, MAX_STRING_LENGTH),
      ...(typeof status === "number" ? { status } : {}),
      ...(typeof code === "string" ? { code } : {}),
      ...(error.stack ? { stack: truncate(error.stack, MAX_STACK_LENGTH) } : {}),
    };
  }

  // A thrown plain object stringifies to "[object Object]", which is the very
  // thing this function exists to prevent, so keep its shape instead.
  if (error !== null && typeof error === "object") {
    return { name: "NonError", value: sanitizeValue(error, 1) };
  }

  return {
    name: "NonError",
    message: truncate(String(error), MAX_STRING_LENGTH),
  };
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return describeError(value);
  if (value instanceof Date) return value.toISOString();

  switch (typeof value) {
    case "string":
      return truncate(value, MAX_STRING_LENGTH);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return String(value);
    case "function":
    case "symbol":
      return `[${typeof value}]`;
    default:
      break;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[array]";
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `…(+${value.length - MAX_ARRAY_ITEMS})`]
      : items;
  }

  if (depth >= MAX_DEPTH) return "[object]";
  return sanitizeFields(value as LogFields, depth + 1);
}

function sanitizeFields(fields: LogFields, depth: number): LogFields {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      sanitized[key] = REDACTED;
    } else if (key === "error") {
      sanitized[key] = describeError(value);
    } else {
      sanitized[key] = sanitizeValue(value, depth);
    }
  }
  return sanitized;
}

/**
 * Builds the record a log line serialises to. Pure, so redaction can be tested
 * without capturing console output.
 */
export function buildLogRecord(input: {
  level: LogLevel;
  event: string;
  fields?: LogFields;
  time?: string;
}): LogFields {
  const fields = sanitizeFields(input.fields ?? {}, 0);
  // Caller fields must not be able to rewrite the record's own identity.
  for (const reserved of RESERVED_KEYS) delete fields[reserved];

  return {
    level: input.level,
    event: input.event,
    time: input.time ?? new Date().toISOString(),
    ...fields,
  };
}

function resolveMinimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  return configured && configured in LEVEL_ORDER
    ? (configured as LogLevel)
    : "info";
}

function emit(level: LogLevel, event: string, fields: LogFields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveMinimumLevel()]) return;

  const line = JSON.stringify(buildLogRecord({ level, event, fields }));
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Creates a logger whose bindings are repeated on every record it writes.
 *
 * Bind the request's identity once — route, requestId, uid — and the retry,
 * the fallback, and the eventual failure all carry it without each call site
 * having to remember.
 */
export function createLogger(bindings: LogFields = {}): Logger {
  const write =
    (level: LogLevel) => (event: string, fields?: LogFields) =>
      emit(level, event, { ...bindings, ...fields });

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}
