export const TYPE_COLORS = 8;

export function typeColorIndex(type: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < type.length; i++) {
    hash = Math.imul(hash ^ type.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0) % TYPE_COLORS;
}

export function typeColorVar(type: string): string {
  return `var(--type-${typeColorIndex(type) + 1})`;
}
