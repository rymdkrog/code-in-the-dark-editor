const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a Revision was exported, "12 Oct 14:03", in UTC like its stamp `3-202610121403`. */
export function revisionTime(stamp: string): string {
  const match = stamp.match(/-\d{4}(\d\d)(\d\d)(\d\d)(\d\d)$/);
  // Shown as it is rather than not at all.
  if (!match) return stamp;
  const [, month, day, hour, minute] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${hour}:${minute}`;
}
