import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) return <p className="status">{t("common.loading")}</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
