// Shared random ID generator for frontend
// Produces an 8-character base36 string
export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
