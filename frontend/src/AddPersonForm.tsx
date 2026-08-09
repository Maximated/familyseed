import { useEffect, useState } from "react";
import {
  createIndividual,
  fetchIndividuals,
  type Individual,
  type Relationship,
  type Sex,
  type UnionType,
} from "./api";

type RelationshipKind = "NONE" | "CHILD_OF_PARENTS" | "PARTNER";

type Props = {
  onCreated: (newPersonId: string) => void;
  onClose: () => void;
};

function personLabel(person: Individual) {
  const year = person.birthDateText ? ` (${person.birthDateText})` : "";
  return `${person.givenNames} ${person.surname}${year}`;
}

export default function AddPersonForm({ onCreated, onClose }: Props) {
  const [individuals, setIndividuals] = useState<Individual[]>([]);
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind>("CHILD_OF_PARENTS");
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [unionType, setUnionType] = useState<UnionType>("MARRIAGE");
  const [unionDateText, setUnionDateText] = useState("");
  const [unionPlace, setUnionPlace] = useState("");

  const [givenNames, setGivenNames] = useState("");
  const [surname, setSurname] = useState("");
  const [birthSurname, setBirthSurname] = useState("");
  const [sex, setSex] = useState<Sex>("UNKNOWN");
  const [birthDateText, setBirthDateText] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [deathDateText, setDeathDateText] = useState("");
  const [deathPlace, setDeathPlace] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIndividuals()
      .then(setIndividuals)
      .catch((err: Error) => setError(err.message));
  }, []);

  function buildRelationship(): Relationship | undefined {
    if (relationshipKind === "CHILD_OF_PARENTS") {
      return {
        kind: "CHILD_OF_PARENTS",
        parent1Id,
        parent2Id: parent2Id || undefined,
      };
    }
    if (relationshipKind === "PARTNER") {
      return {
        kind: "PARTNER",
        partnerId,
        unionType,
        unionDateText: unionDateText || undefined,
        unionPlace: unionPlace || undefined,
      };
    }
    return undefined;
  }

  function validate(): string | null {
    if (!givenNames.trim() || !surname.trim()) {
      return "El nombre y el apellido son obligatorios.";
    }
    if (relationshipKind === "CHILD_OF_PARENTS" && !parent1Id) {
      return "Elige al menos un padre/madre.";
    }
    if (relationshipKind === "PARTNER" && !partnerId) {
      return "Elige la persona con la que forma pareja.";
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { individual } = await createIndividual({
        individual: {
          givenNames: givenNames.trim(),
          surname: surname.trim(),
          birthSurname: birthSurname.trim() || undefined,
          sex,
          birthDateText: birthDateText.trim() || undefined,
          birthPlace: birthPlace.trim() || undefined,
          deathDateText: deathDateText.trim() || undefined,
          deathPlace: deathPlace.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        relationship: buildRelationship(),
      });
      onCreated(individual.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Añadir persona</h2>

        <fieldset>
          <legend>Relación con el árbol</legend>
          <label>
            <input
              type="radio"
              checked={relationshipKind === "CHILD_OF_PARENTS"}
              onChange={() => setRelationshipKind("CHILD_OF_PARENTS")}
            />
            Es hijo/a de
          </label>
          {relationshipKind === "CHILD_OF_PARENTS" && (
            <div className="indent">
              <select value={parent1Id} onChange={(e) => setParent1Id(e.target.value)}>
                <option value="">— Padre/madre —</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <select value={parent2Id} onChange={(e) => setParent2Id(e.target.value)}>
                <option value="">— Otro padre/madre (opcional) —</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Si los dos padres elegidos no tienen ya una unión registrada entre
                ellos, se crea una unión nueva solo para ellos dos — así se
                representan también los hijos de relaciones extramatrimoniales o
                de una pareja no registrada como matrimonio.
              </p>
            </div>
          )}

          <label>
            <input
              type="radio"
              checked={relationshipKind === "PARTNER"}
              onChange={() => setRelationshipKind("PARTNER")}
            />
            Es cónyuge/pareja de
          </label>
          {relationshipKind === "PARTNER" && (
            <div className="indent">
              <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">— Persona —</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <select value={unionType} onChange={(e) => setUnionType(e.target.value as UnionType)}>
                <option value="MARRIAGE">Matrimonio</option>
                <option value="PARTNERSHIP">Pareja de hecho</option>
                <option value="UNKNOWN">Desconocido</option>
              </select>
              <input
                type="text"
                placeholder="Fecha de la unión (ej. 1997, hacia 1990)"
                value={unionDateText}
                onChange={(e) => setUnionDateText(e.target.value)}
              />
              <input
                type="text"
                placeholder="ej. Kraków, Polonia"
                value={unionPlace}
                onChange={(e) => setUnionPlace(e.target.value)}
              />
            </div>
          )}

          <label>
            <input
              type="radio"
              checked={relationshipKind === "NONE"}
              onChange={() => setRelationshipKind("NONE")}
            />
            Sin relación conocida (nuevo ancestro)
          </label>
        </fieldset>

        <fieldset>
          <legend>Datos de la persona</legend>
          <label>
            Nombre
            <input value={givenNames} onChange={(e) => setGivenNames(e.target.value)} required />
          </label>
          <label>
            Apellido
            <input value={surname} onChange={(e) => setSurname(e.target.value)} required />
          </label>
          <label>
            Apellido de soltera/nacimiento (si difiere)
            <input
              placeholder="ej. Kowalski"
              value={birthSurname}
              onChange={(e) => setBirthSurname(e.target.value)}
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
        </fieldset>

        {error && <p className="status status-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
