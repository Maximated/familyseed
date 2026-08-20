const KEY = "familyseed_pending_invite";

// Remembers an invite link id across a full-page navigation round trip
// (Google OAuth has no per-request state of its own to carry this) — set
// right before sending a logged-out visitor off to log in/register/OAuth,
// consumed once by whichever screen they land back on authenticated.
export function setPendingInvite(id: string): void {
  sessionStorage.setItem(KEY, id);
}

export function consumePendingInvite(): string | null {
  const id = sessionStorage.getItem(KEY);
  if (id) sessionStorage.removeItem(KEY);
  return id;
}
