/** Keep SDK traces, transport payloads and internal endpoints in diagnostics. */
export function userMessage(value: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  if (!text || text.length > 240 || /[\r\n{}]|https?:\/\/|(?:Type|Reference|Syntax|Invariant)Error|(?:Program log|custom program error|InstructionError|SecureStore|TurboModule|RPC request|HTTP \d{3}|fetch failed|stack trace|node_modules)/i.test(text)) return fallback;
  return text;
}
