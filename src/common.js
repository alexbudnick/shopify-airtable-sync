export function log(level, currentLevel, msg, meta) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  if ((levels[level] ?? 2) > (levels[currentLevel] ?? 2)) return;
  const stamp = new Date().toISOString();
  if (meta !== undefined) console.log(`[${stamp}] [${level}] ${msg}`, meta);
  else console.log(`[${stamp}] [${level}] ${msg}`);
}

export function safeUpper(value) {
  return String(value || "").toUpperCase();
}
