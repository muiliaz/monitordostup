// Offset between the server clock and this browser's clock, taken from the
// SSE "hello" event. Durations ("down for 3m") and maintenance badges compare
// server timestamps with "now", so "now" must be the server's.
let offsetMs = 0;

export function setServerTime(serverIso: string) {
  offsetMs = new Date(serverIso).getTime() - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}
