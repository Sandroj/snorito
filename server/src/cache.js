// Mini-cache voor data die voor iedereen gelijk is (renners, ploegen, etappes).
// Render (app) en Neon (database) staan niet naast elkaar, dus elke query kost
// merkbaar tijd; deze data verandert alleen bij een uitslag-import of een
// admin-wijziging. Korte TTL als vangnet + expliciet legen bij schrijfacties.
const store = new Map();

export async function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  store.set(key, { at: Date.now(), value });
  return value;
}

// Na een schrijfactie alles weggooien — de cache is klein en de eerstvolgende
// request per endpoint vult hem opnieuw.
export function bustCache() {
  store.clear();
}
