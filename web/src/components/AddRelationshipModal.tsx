import { useEffect, useState } from "react";
import { api, type CodexEntry } from "../api/client";
import Modal, { Field, fieldClass } from "./Modal";
import ChoiceGroup from "./ChoiceGroup";
import EntityPicker from "./EntityPicker";
import { useToast } from "./toastContext";
import { BOND_OPTIONS } from "../lib/bonds";

const BOND_LABELS: Record<string, string> = {
  ally: "Союзник",
  rival: "Соперник",
  family: "Семья",
  romantic: "Роман",
  mentor: "Наставник",
  enemy: "Враг",
  "owes debt": "Должен",
  secret: "Тайна",
  unknown: "Неясно",
  other: "Другое",
};

const ROLE_LABELS: Record<string, string> = {
  protagonist: "Протагонист",
  antagonist: "Антагонист",
  supporting: "Второстепенный",
  minor: "Эпизодический",
};


/** Shared Add Relationship form (chart + Codex Connections). */
export default function AddRelationshipModal({
  open,
  onClose,
  characters,
  projectId,
  onAdded,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  characters: CodexEntry[];
  projectId: string;
  onAdded: () => void;
  prefill?: { source?: string; target?: string } | null;
}) {
  const toast = useToast();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("ally");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed the form from the prefill each time the dialog opens. Adjusted during
  // render, not in an effect, so the first paint already shows the right pair.
  const session = open ? `${prefill?.source ?? ""}>${prefill?.target ?? ""}` : null;
  const [lastSession, setLastSession] = useState<string | null>(null);
  if (session !== lastSession) {
    setLastSession(session);
    if (open) {
      const first = prefill?.source ?? characters[0]?.id ?? "";
      const others = characters.filter((c) => c.id !== prefill?.source);
      setSource(first);
      setTarget(
        prefill?.target
        ?? others[0]?.id
        ?? characters.find((c) => c.id !== first)?.id
        ?? "",
      );
      setLabel("ally");
      setOther("");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const entityOptions = characters.map((c) => ({
    id: c.id,
    name: c.name,
    meta: c.role ? (ROLE_LABELS[c.role] ?? c.role) : undefined,
  }));

  const bondChoices = BOND_OPTIONS.map((o) => ({
    ...o,
    label: BOND_LABELS[o.value] ?? o.label,
  }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !target || source === target) return;
    setBusy(true);
    try {
      await api.addRelationship(projectId, {
        source_id: source,
        target_id: target,
        label: label === "other" ? (other.trim() || "unknown") : label,
      });
      toast("Связь добавлена", "success");
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Добавить связь">
      <form onSubmit={submit}>
        <Field label="От">
          <EntityPicker
            label="От"
            value={source}
            onChange={setSource}
            options={entityOptions}
            excludeId={target}
            placeholder="С кого начинается связь…"
          />
        </Field>
        <Field label="К">
          <EntityPicker
            label="К"
            value={target}
            onChange={setTarget}
            options={entityOptions}
            excludeId={source}
            placeholder="С кем связать…"
          />
        </Field>
        <Field label="Связь">
          <ChoiceGroup
            label="Связь"
            variant="chips"
            size="sm"
            value={label}
            onChange={setLabel}
            options={bondChoices}
          />
        </Field>
        {label === "other" && (
          <Field label="Своя подпись">
            <input
              className={fieldClass}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="например, друзья детства"
            />
          </Field>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost">Отмена</button>
          <button
            type="submit"
            disabled={busy || !source || !target || source === target}
            className="btn-primary disabled:opacity-40"
          >
            {busy ? "Сохранение…" : "Добавить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
