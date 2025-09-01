export function toISODate(epgTime) {
  if (!epgTime) return null;
  const match = epgTime.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}) ([\+\-]\d{4})$/
  );
  if (!match) return epgTime;
  const [_, y, mo, d, h, mi, s, offset] = match;
  const dateStr = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset.slice(
    0,
    3
  )}:${offset.slice(3)}`;
  return new Date(dateStr).toISOString();
}