import { useCallback, useEffect, useState } from "react";
import { api, type CodexEntryType, type CodexProposal } from "../api/client";
import { useToast } from "./toastContext";
import Icon from "./Icon";
import Select from "./Select";

const TYPES: { value: CodexEntryType; label: string }[] = [
  { value: "character", label: "Персонаж" },
  { value: "location", label: "Место" },
  { value: "worldbuilding", label: "Мир" },
  { value: "item", label: "Предмет" },
];

function ruCardinal(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function proposalSummary(n: number): string {
  const word = ruCardinal(n, "имя", "имени", "имён");
  return `${n} ${word} ещё нет в Кодексе. Ничего не сохранится, пока вы не добавите.`;
}

function localizeEvidence(evidence: string): string {
  return evidence
    .replace(/(\d+) mentions/g, (_, raw: string) => {
      const n = Number(raw);
      return `${n} ${ruCardinal(n, "упоминание", "упоминания", "упоминаний")}`;
    })
    .replace(/\bspeaks\b/g, "говорит")
    .replace(/\bhas a title\b/g, "есть титул")
    .replace(/\bused as a place\b/g, "как место")
    .replace(/\bpossessive form\b/g, "притяжательная форма")
    .replace(/\brecurring proper noun\b/g, "повторяется")
    .replace(/\bnamed place\b/g, "названное место")
    .replace(/\bfull name\b/g, "полное имя")
    .replace(/\bin (\d+) chapters\b/g, (_, raw: string) => {
      const n = Number(raw);
      const word = n % 10 === 1 && n % 100 !== 11 ? "главе" : "главах";
      return `в ${n} ${word}`;
    });
}

/**
 * Review queue for Codex entries found in the manuscript (PLAN.md P2.2).
 *
 * The friction this removes is the category's worst: rival tools make you
 * re-type a cast the draft already contains. Nothing here is ever written
 * without a click - every row is a proposal, and dismissing one is as cheap as
 * accepting it, because a review queue people feel trapped in is a review queue
 * they close.
 *
 * Each row states its own evidence and shows a line of the writer's own prose,
 * so a proposal can be judged without opening the chapter.
 */
export default function CodexProposals({
  projectId,
  onAccepted,
}: {
  projectId: string;
  onAccepted: () => void;
}) {
  const toast = useToast();
  const [proposals, setProposals] = useState<CodexProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [types, setTypes] = useState<Record<string, CodexEntryType>>({});
  const [open, setOpen] = useState(true);

  const load = useCallback(() => {
    api.codexProposals(projectId)
      .then(setProposals)
      .catch(() => setProposals([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const visible = proposals.filter((p) => !dismissed.has(p.name));
  if (loading || visible.length === 0) return null;

  async function accept(p: CodexProposal) {
    setBusy(p.name);
    try {
      await api.addCodexEntry(projectId, {
        entry_type: types[p.name] ?? p.entry_type,
        name: p.name,
        summary: p.excerpt,
      });
      // Drop it locally rather than refetching: the writer is mid-triage and a
      // list that reorders under the cursor loses their place.
      setDismissed((d) => new Set(d).add(p.name));
      onAccepted();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Предложения Кодекса"
      className="mb-6 rounded-[24px] border border-[rgba(104,103,234,0.22)] bg-[rgba(104,103,234,0.05)] px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 font-display text-[16px] font-semibold tracking-tight text-ink-text">
            <Icon name="sparkles" className="h-4 w-4 text-[var(--color-violet)]" />
            Найдено в рукописи
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {proposalSummary(visible.length)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost px-2.5 py-1 text-[12px]"
            onClick={() => setDismissed(new Set(proposals.map((p) => p.name)))}
          >
            Скрыть всё
          </button>
          <button
            type="button"
            aria-expanded={open}
            className="btn-ghost px-2.5 py-1 text-[12px]"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Свернуть" : "Показать"}
          </button>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-1.5">
          {visible.map((p) => (
            <li
              key={p.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgba(74,91,133,0.12)] bg-white/70 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-ink-text">
                  {p.name}
                </p>
                <p className="truncate text-[11.5px] text-ink-muted" title={p.excerpt}>
                  {localizeEvidence(p.evidence)}
                  {p.excerpt ? ` · «${p.excerpt}»` : ""}
                </p>
              </div>

              <Select
                label={`Тип для ${p.name}`}
                size="sm"
                value={types[p.name] ?? p.entry_type}
                onChange={(v) =>
                  setTypes((t) => ({ ...t, [p.name]: v as CodexEntryType }))
                }
                options={TYPES}
              />

              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Скрыть ${p.name}`}
                  className="btn-ghost px-2 py-0.5 text-[12px]"
                  onClick={() => setDismissed((d) => new Set(d).add(p.name))}
                >
                  Скрыть
                </button>
                <button
                  type="button"
                  aria-label={`Добавить ${p.name} в Кодекс`}
                  disabled={busy === p.name}
                  className="btn-secondary px-2 py-0.5 text-[12px] disabled:opacity-40"
                  onClick={() => void accept(p)}
                >
                  {busy === p.name ? "Добавление…" : "Добавить"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
