import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { peekInviteLink, redeemInviteLink, type InviteLinkPeek } from "./api";
import { useAuth } from "./AuthContext";
import { setPendingInvite } from "./pendingInvite";
import GoogleAuthButton from "./GoogleAuthButton";

export default function InviteRedeem() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [peek, setPeek] = useState<InviteLinkPeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!id) return;
    peekInviteLink(id)
      .then(setPeek)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (id && !authLoading && !user) setPendingInvite(id);
  }, [id, authLoading, user]);

  async function handleJoin() {
    if (!id) return;
    setJoining(true);
    setError(null);
    try {
      const { treeId } = await redeemInviteLink(id);
      navigate(`/tree/${treeId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  if (!id) return null;

  return (
    <div className="auth-page">
      <div className="auth-form">
        <h1>{t("inviteRedeem.title")}</h1>

        {loading || authLoading ? (
          <p className="status">{t("common.loading")}</p>
        ) : error ? (
          <p className="status status-error">{error}</p>
        ) : peek && !peek.valid ? (
          <p className="status status-error">{t(`inviteRedeem.invalid.${peek.reason}`)}</p>
        ) : peek ? (
          <>
            <p>{t("inviteRedeem.body", { treeName: peek.treeName, role: t(`roles.${peek.role}`) })}</p>
            {user ? (
              <button type="button" onClick={handleJoin} disabled={joining}>
                {joining ? t("inviteRedeem.joiningButton") : t("inviteRedeem.joinButton")}
              </button>
            ) : (
              <>
                <Link to="/login">{t("inviteRedeem.loginAction")}</Link>
                <Link to="/register">{t("inviteRedeem.registerAction")}</Link>
                <GoogleAuthButton />
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
