// Eenvoudige in-memory rate limiting (sliding window). Reset bij een herstart
// van de server — voor login- en wachtwoord-reset-misbruik is dat ruim voldoende.
const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { buckets.set(key, recent); return false; }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}
