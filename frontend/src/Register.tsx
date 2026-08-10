import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function Register() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(email.trim(), password, name.trim() || undefined);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>{t("auth.registerTitle")}</h1>
        <label>
          {t("auth.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          {t("auth.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t("auth.password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="status status-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? t("auth.registerButtonBusy") : t("auth.registerButton")}
        </button>
        <Link to="/login" className="auth-switch-link">
          {t("auth.hasAccount")}
        </Link>
      </form>
    </div>
  );
}
