import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";
import { consumePendingInvite } from "./pendingInvite";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) return <p className="status">{t("common.loading")}</p>;
  if (!user) return <Navigate to="/login" replace />;

  // Catches the Google OAuth round trip landing back on "/" — OAuth has no
  // per-request state to carry a returnTo through the way a plain
  // login/register form navigation can (see Login.tsx/Register.tsx), so
  // this is the one shared place that picks a pending invite back up
  // regardless of which of the three auth paths the visitor took.
  const pendingInvite = consumePendingInvite();
  if (pendingInvite) return <Navigate to={`/invite/${pendingInvite}`} replace />;

  return <>{children}</>;
}
