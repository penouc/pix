export function greeting(name) {
  const normalized = name.trim().toLowerCase();
  return `Hello, ${normalized}`;
}
