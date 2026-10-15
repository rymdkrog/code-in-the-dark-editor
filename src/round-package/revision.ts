// A Revision is a per-Round counter plus a UTC minute stamp: `3-202610121403`.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a Revision was exported, "12 Oct 14:03", in UTC like its stamp `3-202610121403`. */
export function revisionTime(stamp: string): string {
  const match = stamp.match(/-\d{4}(\d\d)(\d\d)(\d\d)(\d\d)$/);
  // Shown as it is rather than not at all.
  if (!match) return stamp;
  const [, month, day, hour, minute] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${hour}:${minute}`;
}

/** Revision `n`, stamped with the UTC minute of `now`: `3-202610121403`. */
export const revisionOf = (n: number, now: Date) => `${n}-${now.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`;

/** The same minute stamp with another counter: `2-202610121403` for `3-202610121403` and 2. */
export const withCounter = (revision: string, n: number) => revision.replace(/^\d+/, String(n));

/** Whether a string is a Revision. */
export const isRevision = (value: string) => /^\d+-\d{12}$/.test(value);

/** The counter in a Revision: 3 for `3-202610121403`. */
export const revisionNumber = (revision: string) => Number(/^\d+/.exec(revision)?.[0] ?? 0);

/** Whether Revision `a` is newer than `b`: a later counter, or the same counter exported later. */
export function isNewerRevision(a: string, b: string): boolean {
  const [na, nb] = [revisionNumber(a), revisionNumber(b)];
  return na !== nb ? na > nb : a > b;
}
