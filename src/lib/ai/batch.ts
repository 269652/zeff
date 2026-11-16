// (pure: the plugins' ports bundle it)
/** The items in batches in their order: a new one when the next item would make it longer than `limit` (or it has `max` items). */
export function batchByChars<T>(items: T[], sizeOf: (item: T) => number, limit: number, max = Infinity): T[][] {
  const batches: T[][] = [];
  let size = 0;
  for (const item of items) {
    const n = sizeOf(item);
    if (!batches.length || size + n > limit || batches[batches.length - 1].length >= max) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1].push(item);
    size += n;
  }
  return batches;
}
