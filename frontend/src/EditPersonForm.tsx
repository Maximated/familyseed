import { useEffect, useState } from "react";
import {
  deleteIndividual,
  fetchIndividual,
  updateIndividual,
  type Individual,
  type Sex,
  type UpdateIndividualPayload,
} from "./api";

type Props = {
  personId: string;
  onSaved: (personId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
};

export default function EditPersonForm({ personId, onSaved, onDeleted, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [givenNames, setGivenNames] = useState("");
  const [surname1, setSurname1] = useState("");
  const [surname2, setSurname2] = useState("");
  const [surname1BirthName, setSurname1BirthName] = useState("");
  const [alias, setAlias] = useState("");
  const [sex, setSex] = useState<Sex>("UNKNOWN");
  const [birthDateText, setBirthDateText] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [deathDateText, setDeathDateText] = useState("");
  const [deathPlace, setDeathPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [biography, setBiography] = useState("");

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchIndividual(personId)
      .then((person: Individual) => {
        setGivenNames(person.givenNames);
        setSurname1(person.surname1);
        setSurname2(person.surname2 ?? "");
        setSurname1BirthName(person.surname1BirthName ?? "");
        setAlias(person.alias ?? "");
        setSex(person.sex);
        setBirthDateText(person.birthDateText ?? "");
        setBirthPlace(person.birthPlace ?? "");
        setDeathDateText(person.deathDateText ?? "");
        setDeathPlace(person.deathPlace ?? "");
        setNotes(person.notes ?? "");
        setBiography(person.biography ?? "");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [personId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!givenNames.trim() || !surname1.trim()) {
      setError("El nombre y el primer apellido son obligatorios.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: UpdateIndividualPayload = {
        givenNames: givenNames.trim(),
        surname1: surname1.trim(),
        surname2: surname2.trim() || undefined,
        surname1BirthName: surname1BirthName.trim() || undefined,
        alias: alias.trim() || undefined,
        sex,
        birthDateText: birthDateText.trim() || undefined,
        birthPlace: birthPlace.trim() || undefined,
        deathDateText: deathDateText.trim() || undefined,
        deathPlace: deathPlace.trim() || undefined,
        notes: notes.trim() || undefined,
        biography: biography.trim() || undefined,
      };
      await updateIndividual(personId, payload);
      onSaved(personId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteIndividual(personId);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Editar persona</h2>

        {loading ? (
          <p className="status">Cargando…</p>
        ) : (
          <>
            <fieldset>
              <legend>Datos de la persona</legend>
              <label>
                Nombre
                <input value={givenNames} onChange={(e) => setGivenNames(e.target.value)} required />
              </label>
              <label>
                Primer apellido (paterno en España, único en Polonia)
                <input value={surname1} onChange={(e) => setSurname1(e.target.value)} required />
              </label>
              <label>
                Segundo apellido (materno — opcional, convención española)
                <input value={surname2} onChange={(e) => setSurname2(e.target.value)} />
              </label>
              <label>
                Primer apellido de nacimiento (si difiere del actual)
                <input
                  placeholder="ej. Kowalski"
                  value={surname1BirthName}
                  onChange={(e) => setSurname1BirthName(e.target.value)}
                />
              </label>
              <label>
                Apodo o alias (opcional)
                <input
                  placeholder="ej. Boni"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </label>
              <label>
                Sexo
                <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                  <option value="UNKNOWN">Desconocido</option>
                  <option value="MALE">Hombre</option>
                  <option value="FEMALE">Mujer</option>
                </select>
              </label>
              <label>
                Fecha de nacimiento
                <input
                  type="text"
                  placeholder="ej. 1950, hacia 1927, 12 marzo 1925"
                  value={birthDateText}
                  onChange={(e) => setBirthDateText(e.target.value)}
                />
              </label>
              <label>
                Lugar de nacimiento
                <input
                  placeholder="ej. Kraków, Polonia"
                  value={birthPlace}
                  onChange={(e) => setBirthPlace(e.target.value)}
                />
              </label>
              <label>
                Fecha de defunción
                <input
                  type="text"
                  placeholder="ej. 1998, hacia 1965, 2 noviembre 1998"
                  value={deathDateText}
                  onChange={(e) => setDeathDateText(e.target.value)}
                />
              </label>
              <label>
                Lugar de defunción
                <input
                  placeholder="ej. Kraków, Polonia"
                  value={deathPlace}
                  onChange={(e) => setDeathPlace(e.target.value)}
                />
              </label>
              <label>
                Notas
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </label>
              <label>
                Biografía
                <textarea
                  placeholder="Un relato breve sobre esta persona: su vida, oficio, anécdotas…"
                  value={biography}
                  onChange={(e) => setBiography(e.target.value)}
                  rows={4}
                />
              </label>
            </fieldset>

            {error && <p className="status status-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={submitting || deleting}>
                Cancelar
              </button>
              <button type="submit" disabled={submitting || deleting}>
                {submitting ? "Guardando…" : "Guardar"}
              </button>
            </div>

            <div className="danger-zone">
              {!confirmingDelete ? (
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={submitting || deleting}
                >
                  Eliminar persona
                </button>
              ) : (
                <div className="delete-confirm">
                  <p>
                    ¿Seguro que quieres eliminar a <strong>{givenNames} {surname1}</strong>?
                    Pasará a la papelera — podrás restaurarla más tarde si te equivocas.
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="delete-button"
                      onClick={handleConfirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Eliminando…" : "Sí, eliminar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
