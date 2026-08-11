import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addTreeMember,
  fetchTreeMembers,
  removeTreeMember,
  updateTreeMemberRole,
  type ShareRole,
  type TreeMemberInfo,
} from "./api";

type Props = {
  treeId: string;
  onClose: () => void;
};

export default function ShareTreeModal({ treeId, onClose }: Props) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<TreeMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("VIEWER");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchTreeMembers(treeId)
      .then(setMembers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [treeId]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const member = await addTreeMember(treeId, email.trim(), role);
      setMembers((prev) => [...prev, member]);
      setEmail("");
      setRole("VIEWER");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: ShareRole) {
    setError(null);
    const previous = members;
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)));
    try {
      await updateTreeMemberRole(treeId, userId, newRole);
    } catch (err) {
      setMembers(previous);
      setError((err as Error).message);
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    const previous = members;
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    try {
      await removeTreeMember(treeId, userId);
    } catch (err) {
      setMembers(previous);
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("share.title")}</h2>

        <fieldset>
          <legend>{t("share.addLegend")}</legend>
          <form onSubmit={handleAdd} className="field-row">
            <input
              type="email"
              placeholder={t("share.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
              <option value="VIEWER">{t("roles.VIEWER")}</option>
              <option value="EDITOR">{t("roles.EDITOR")}</option>
            </select>
            <button type="submit" disabled={submitting}>
              {submitting ? t("common.saving") : t("share.addAction")}
            </button>
          </form>
          <p className="field-hint">{t("share.addHint")}</p>
        </fieldset>

        <fieldset>
          <legend>{t("share.membersLegend")}</legend>
          {loading ? (
            <p className="status">{t("common.loading")}</p>
          ) : members.length === 0 ? (
            <p className="field-hint">{t("share.noMembers")}</p>
          ) : (
            <ul className="share-members-list">
              {members.map((member) => (
                <li key={member.userId} className="share-member-row">
                  <span className="share-member-identity">{member.name ?? member.email ?? member.userId}</span>
                  {member.role === "OWNER" ? (
                    <span className="field-hint">{t("roles.OWNER")}</span>
                  ) : (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.userId, e.target.value as ShareRole)}
                      >
                        <option value="VIEWER">{t("roles.VIEWER")}</option>
                        <option value="EDITOR">{t("roles.EDITOR")}</option>
                      </select>
                      <button type="button" className="delete-button" onClick={() => handleRemove(member.userId)}>
                        {t("share.removeAction")}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {error && <p className="status status-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
