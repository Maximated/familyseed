import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addTreeMember,
  createInviteLink,
  fetchInviteLinks,
  fetchTreeMembers,
  inviteLinkUrl,
  removeTreeMember,
  revokeInviteLink,
  updateTreeMemberRole,
  type InviteLinkInfo,
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

  const [links, setLinks] = useState<InviteLinkInfo[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linkRole, setLinkRole] = useState<ShareRole>("VIEWER");
  const [linkExpiresAt, setLinkExpiresAt] = useState("");
  const [linkMaxUses, setLinkMaxUses] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchTreeMembers(treeId)
      .then(setMembers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    fetchInviteLinks(treeId)
      .then(setLinks)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLinksLoading(false));
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

  async function handleCreateLink(event: React.FormEvent) {
    event.preventDefault();
    setCreatingLink(true);
    setError(null);
    try {
      const maxUses = linkMaxUses.trim() ? Number(linkMaxUses) : undefined;
      const expiresAt = linkExpiresAt ? new Date(linkExpiresAt).toISOString() : undefined;
      const link = await createInviteLink(treeId, { role: linkRole, expiresAt, maxUses });
      setLinks((prev) => [link, ...prev]);
      setLinkExpiresAt("");
      setLinkMaxUses("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingLink(false);
    }
  }

  async function handleRevokeLink(id: string) {
    setError(null);
    const previous = links;
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, revokedAt: new Date().toISOString() } : l)));
    try {
      await revokeInviteLink(treeId, id);
    } catch (err) {
      setLinks(previous);
      setError((err as Error).message);
    }
  }

  async function handleCopyLink(id: string) {
    await navigator.clipboard.writeText(inviteLinkUrl(id));
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
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

        <fieldset>
          <legend>{t("share.linksLegend")}</legend>
          <form onSubmit={handleCreateLink}>
            <label>
              {t("share.linkRoleLabel")}
              <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as ShareRole)}>
                <option value="VIEWER">{t("roles.VIEWER")}</option>
                <option value="EDITOR">{t("roles.EDITOR")}</option>
              </select>
            </label>
            <label>
              {t("share.linkExpiresLabel")}
              <input type="date" value={linkExpiresAt} onChange={(e) => setLinkExpiresAt(e.target.value)} />
            </label>
            <label>
              {t("share.linkMaxUsesLabel")}
              <input
                type="number"
                min={1}
                placeholder={t("share.linkMaxUsesPlaceholder")}
                value={linkMaxUses}
                onChange={(e) => setLinkMaxUses(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="submit" disabled={creatingLink}>
                {creatingLink ? t("common.saving") : t("share.createLinkAction")}
              </button>
            </div>
          </form>
          <p className="field-hint">{t("share.linksHint")}</p>

          {linksLoading ? (
            <p className="status">{t("common.loading")}</p>
          ) : links.length === 0 ? (
            <p className="field-hint">{t("share.noLinks")}</p>
          ) : (
            <ul className="share-members-list">
              {links.map((link) => {
                const revoked = Boolean(link.revokedAt);
                const expired = Boolean(link.expiresAt && new Date(link.expiresAt) < new Date());
                const usage =
                  link.maxUses !== null
                    ? t("share.linkUsageOfMax", { count: link.useCount, max: link.maxUses })
                    : t("share.linkUsage", { count: link.useCount });
                return (
                  <li key={link.id} className="share-member-row">
                    <span className="share-member-identity">
                      {t(`roles.${link.role}`)}
                      {" · "}
                      {usage}
                      {revoked && ` · ${t("share.linkRevoked")}`}
                      {!revoked && expired && ` · ${t("share.linkExpired")}`}
                    </span>
                    {!revoked && !expired && (
                      <button type="button" className="btn-outline" onClick={() => handleCopyLink(link.id)}>
                        {copiedId === link.id ? t("share.linkCopied") : t("share.copyLinkAction")}
                      </button>
                    )}
                    {!revoked && (
                      <button type="button" className="delete-button" onClick={() => handleRevokeLink(link.id)}>
                        {t("share.revokeLinkAction")}
                      </button>
                    )}
                  </li>
                );
              })}
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
