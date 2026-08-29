type LogFields = Record<string, unknown>;

function emit(level: string, message: string, fields?: LogFields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...sanitize(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

function sanitize(fields?: LogFields) {
  if (!fields) return {};
  const blocked = /token|secret|password|authorization|credential|api[_-]?key/i;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (blocked.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
