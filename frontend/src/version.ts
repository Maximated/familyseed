export const APP_COMMIT = __APP_COMMIT__;

const REPO = "Maximated/familyseed";
const CHECK_CACHE_KEY = "familyseed_update_check";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — plenty fresh for a self-hosted app, easy on GitHub's unauthenticated rate limit

type CachedCheck = { checkedAt: number; latestSha: string | null };

function readCache(): CachedCheck | null {
  try {
    const raw = localStorage.getItem(CHECK_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedCheck) : null;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedCheck) {
  try {
    localStorage.setItem(CHECK_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Not fatal — just means every load re-checks instead of using the cache.
  }
}

// Compares this build's baked-in commit against the latest commit on the
// repo's main branch (public GitHub API, no auth needed). Never throws —
// a failed/offline check just means no update banner, not an error shown
// to the user.
export async function checkForUpdate(): Promise<{ hasUpdate: boolean; latestSha: string | null }> {
  if (APP_COMMIT === "dev") return { hasUpdate: false, latestSha: null };

  const cached = readCache();
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return { hasUpdate: cached.latestSha !== null && cached.latestSha !== APP_COMMIT, latestSha: cached.latestSha };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { hasUpdate: false, latestSha: null };
    const data = (await res.json()) as { sha?: string };
    const latestSha = data.sha ? data.sha.slice(0, 7) : null;
    writeCache({ checkedAt: Date.now(), latestSha });
    return { hasUpdate: latestSha !== null && latestSha !== APP_COMMIT, latestSha };
  } catch {
    return { hasUpdate: false, latestSha: null };
  }
}
