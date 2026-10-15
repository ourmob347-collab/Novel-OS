import { useCallback, useEffect, useState } from "react";
import {
  api, type CompileFormat, type CompileStyle, type StyleSheet,
} from "../api/client";
import { useToast } from "./toastContext";
import Icon from "./Icon";
import Select from "./Select";

/**
 * Compile the book through its named styles (PLAN.md P5.2 / P6).
 *
 * Only the handful of styles a writer actually changes are exposed. The full
 * sheet exists in the API, but a panel with seven roles times eleven properties
 * is a settings screen, and settings screens are how Scrivener earned its
 * reputation for needing tutorials.
 *
 * Nothing here can alter a word: a style names an appearance, and appearance is
 * not story truth.
 */
const EDITABLE: { role: string; label: string; hint: string }[] = [
  { role: "chapter_title", label: "Заголовок главы", hint: "Заголовок каждой главы" },
  { role: "body", label: "Основной текст", hint: "Обычная проза" },
  { role: "block_quote", label: "Цитата", hint: "Письма и эпиграфы" },
];

const FONTS = [
  { value: "serif", label: "С засечками" },
  { value: "sans", label: "Без засечек" },
  { value: "mono", label: "Моно" },
];

const ALIGNMENTS = [
  { value: "left", label: "По левому" },
  { value: "center", label: "По центру" },
  { value: "justify", label: "По ширине" },
];

export default function CompilePanel({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<StyleSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<CompileFormat>("html");

  const load = useCallback(() => {
    api.styles(projectId).then(setSheet).catch(() => setSheet(null));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (!sheet) return null;

  function patch(role: string, change: Partial<CompileStyle>) {
    setSheet((s) =>
      s ? { ...s, styles: { ...s.styles, [role]: { ...s.styles[role], ...change } } } : s,
    );
  }

  async function save() {
    if (!sheet) return;
    setBusy(true);
    try {
      // The API validates the whole sheet and rejects it entire, so the answer
      // it sends back is the truth about what is stored.
      setSheet(await api.saveStyles(projectId, sheet));
      toast("Стили сохранены", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Сборка"
      className="mb-6 rounded-[24px] border border-[rgba(74,91,133,0.12)] bg-white/55 px-5 py-5 backdrop-blur-md"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold tracking-tight text-ink-text">
            Сборка
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Именованные стили задают выгрузку: измените один — и книга последует
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Формат"
            size="sm"
            value={format}
            onChange={(v) => setFormat(v as CompileFormat)}
            options={[
              { value: "docx", label: "Word (.docx)" },
              { value: "epub", label: "EPUB" },
              { value: "html", label: "HTML" },
              { value: "markdown", label: "Markdown" },
            ]}
          />
          <a
            href={api.compileUrl(projectId, format)}
            download
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Icon name="download" className="h-3.5 w-3.5" /> Собрать
          </a>
        </div>
      </div>

      <div className="space-y-3">
        {EDITABLE.map(({ role, label, hint }) => {
          const style = sheet.styles[role];
          if (!style) return null;
          return (
            <div
              key={role}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgba(74,91,133,0.12)] bg-white/70 px-3 py-2"
            >
              <div className="min-w-[9rem] flex-1">
                <p className="text-[13px] font-medium text-ink-text">{label}</p>
                <p className="text-[11.5px] text-ink-muted">{hint}</p>
              </div>

              <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                Кегль
                <input
                  type="number"
                  min={4}
                  max={96}
                  step={0.5}
                  value={style.size_pt}
                  aria-label={`${label}, кегль`}
                  onChange={(e) => patch(role, { size_pt: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-[rgba(96,112,153,0.2)] bg-white/80 px-2 py-1 text-[12px] text-ink-text"
                />
              </label>

              <Select
                label={`${label}, шрифт`}
                size="sm"
                value={style.font}
                onChange={(v) => patch(role, { font: v })}
                options={FONTS}
              />
              <Select
                label={`${label}, выравнивание`}
                size="sm"
                value={style.align}
                onChange={(v) => patch(role, { align: v })}
                options={ALIGNMENTS}
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="flex items-center gap-2 text-[12px] text-ink-muted">
            Разрыв сцены
            <input
              value={sheet.scene_break_marker}
              aria-label="Знак разрыва сцены"
              onChange={(e) =>
                setSheet((s) => (s ? { ...s, scene_break_marker: e.target.value } : s))
              }
              className="w-28 rounded-lg border border-[rgba(96,112,153,0.2)] bg-white/80 px-2 py-1 text-[12px] text-ink-text"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="btn-secondary disabled:opacity-40"
          >
            {busy ? "Сохранение…" : "Сохранить стили"}
          </button>
        </div>
      </div>
    </section>
  );
}
