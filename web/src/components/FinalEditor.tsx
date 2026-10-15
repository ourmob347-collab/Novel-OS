import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import RichTextEditor, { type CommentAnchor } from "./RichTextEditor";
import SuggestionsPanel from "./SuggestionsPanel";
import SelectionBubble from "./SelectionBubble";
import {
  BAR_ACTIONS, SELECTION_ACTIONS, type SelectionActionId,
} from "../lib/selectionActions";
import {
  EMPTY_DOC,
  insertImage,
  insertSceneBreak,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleItalic,
  type EditorHandle,
  type PMDoc,
} from "../lib/richText";
import { api, type CodexEntry } from "../api/client";
import { READER_FONTS, getReaderFont, setReaderFont, type ReaderFont } from "../theme";
import ChoiceGroup from "./ChoiceGroup";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import LinkCodexModal from "./LinkCodexModal";
import EntityPopover from "./EntityPopover";
import ConsequencePreviewModal from "./ConsequencePreview";
import { type ConsequencePreview as ConsequencePreviewPayload } from "../api/client";
import { charsInDoc, locateQuote } from "../lib/findQuote";

export type ApplyQuoteResult = "applied" | "missing" | "not-ready";

export type FinalEditorHandle = {
  /** True once the clean-copy editor can take a rewrite. */
  editorReady: () => boolean;
  /** Rewrite a critic quote straight into the clean copy. No preview dialog. */
  applyQuote: (quote: string, instruction: string) => Promise<ApplyQuoteResult>;
};

const SIZES = [0.95, 1.075, 1.2, 1.35];
const MEASURES: Record<string, string> = { narrow: "34rem", normal: "42rem", wide: "52rem" };
type Measure = keyof typeof MEASURES;
const MEASURE_LABEL: Record<Measure, string> = { narrow: "Узко", normal: "Обычно", wide: "Широко" };

function ruCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${n.toLocaleString("ru-RU")} ${word}`;
}

function ruWords(n: number): string {
  return ruCount(n, "слово", "слова", "слов");
}

function ruChars(n: number): string {
  return ruCount(n, "символ", "символа", "символов");
}

/** Visible prose. Paragraph breaks are whitespace for words, not extra symbols. */
function proseStats(doc: PMDoc | null | undefined): { words: number; chars: number } {
  const parts: string[] = [];
  const walk = (node: PMDoc | undefined) => {
    if (!node) return;
    if (typeof node.text === "string") parts.push(node.text);
    for (const child of (node.content || []) as PMDoc[]) walk(child);
  };
  walk(doc ?? undefined);
  const chars = parts.reduce((n, part) => n + part.length, 0);
  const trimmed = parts.join(" ").trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { words, chars };
}

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw != null ? (JSON.parse(raw) as T) : initial;
  });
  return [v, (nv: T) => { setV(nv); localStorage.setItem(key, JSON.stringify(nv)); }];
}

function countWords(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

const FinalEditor = forwardRef<FinalEditorHandle, {
  projectId: string;
  chapterNumber: number;
  hasFinal: boolean;
  canPromote: boolean;
  promoteFrom: string;
  doc: PMDoc;
  wordCount?: number;
  onChange: (doc: PMDoc) => void;
  onSave: () => void;
  onPromote: () => void;
  dirty: boolean;
  busy: null | "saving" | "promoting";
  lastSaved: string | null;
  focus: boolean;
  onToggleFocus: () => void;
  onCommentSelection?: (sel: { from: number; to: number; quote: string }) => void;
  commentAnchors?: CommentAnchor[];
  onEditorReady?: () => void;
}>(function FinalEditor(props, ref) {
  const {
    projectId, chapterNumber, hasFinal, canPromote, promoteFrom, doc, onChange, onSave, onPromote,
    dirty, busy, lastSaved, focus, onToggleFocus, onCommentSelection, commentAnchors = [],
    onEditorReady,
  } = props;

  const handleRef = useRef<EditorHandle | null>(null);
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const [editor, setEditor] = useState<Editor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [suggesting, setSuggesting] = usePersisted("novelos-suggest-mode", false);
  // Attribution reuses the persona convention comments already follow. Single
  // writer today, so it labels rather than authenticates - real identities
  // arrive with P7 auth on the existing tenancy tables.
  const [authorName] = usePersisted("novelos-author-name", "Вы");
  const [sizeIdx, setSizeIdx] = usePersisted("novelos-editor-size", 1);
  const [measure, setMeasure] = usePersisted<Measure>("novelos-editor-measure", "normal");
  const [readerFont, setReaderFontState] = useState<ReaderFont>(getReaderFont);
  const [uploading, setUploading] = useState(false);
  const [liveStats, setLiveStats] = useState(() => proseStats(doc));
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkMode, setLinkMode] = useState<"link" | "create">("link");
  const [seedName, setSeedName] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [entity, setEntity] = useState<{ x: number; y: number; entry: CodexEntry } | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteIntent, setRewriteIntent] = useState<"rewrite" | "expand">("rewrite");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriteSel, setRewriteSel] = useState<{
    from: number; to: number; quote: string; before: string; after: string;
  } | null>(null);
  const chooseFont = (f: ReaderFont) => { setReaderFont(f); setReaderFontState(f); };

  /**
   * Both prose actions land in the same dialog and return the same three-part
   * answer - proposal, what it breaks, what it might mean. Expand only differs
   * by the instruction it starts from, so there is one flow to learn.
   */
  function openRewrite(intent: "rewrite" | "expand" = "rewrite") {
    const sel = handleRef.current?.getSelection();
    if (!sel) return;
    setRewriteSel(sel);
    setRewriteIntent(intent);
    setRewriteInstruction("");
    setRewriteOpen(true);
  }

  const applyQuoteRef = useRef<FinalEditorHandle["applyQuote"]>(async () => "not-ready");
  const hasFinalRef = useRef(hasFinal);
  hasFinalRef.current = hasFinal;
  useImperativeHandle(ref, () => ({
    editorReady: () => hasFinalRef.current && !!handleRef.current?.editor,
    applyQuote: (quote, instruction) => applyQuoteRef.current(quote, instruction),
  }), []);

  async function acceptRewrite(preview: ConsequencePreviewPayload) {
    const ed = handleRef.current?.editor;
    if (!ed || !rewriteSel) throw new Error("Выделение в редакторе потеряно.");
    ed.chain()
      .focus()
      .setTextSelection({ from: rewriteSel.from, to: rewriteSel.to })
      .insertContent(preview.rewritten)
      .run();
    const nextDoc = ed.getJSON() as PMDoc;
    handleChange(nextDoc);
    const result = await api.acceptConsequence(projectId, chapterNumber, {
      preview_id: preview.preview_id,
      rewritten: preview.rewritten,
      doc: nextDoc,
      state_delta: preview.state_delta,
    });
    handleChange(result.final.doc as PMDoc);
  }

  /**
   * One definition of what you can do to a selection, shared by the floating
   * bar and the right-click menu so the two can never offer different things.
   */
  /** The one place an action id becomes behaviour. */
  function runAction(id: SelectionActionId) {
    switch (id) {
      case "rewrite": return openRewrite("rewrite");
      case "expand": return openRewrite("expand");
      case "comment": {
        const sel = handleRef.current?.getSelection();
        if (sel) onCommentSelection?.(sel);
        return;
      }
      case "link": return openLink("link");
      case "create": return openLink("create");
      case "ask":
        document.getElementById("scribe-chat-input")?.focus();
        return;
    }
  }

  function openActionMenu(x: number, y: number) {
    if (mode !== "write") return;
    const hasSelection = !!handleRef.current?.getSelection();
    setCtx({
      x,
      y,
      items: SELECTION_ACTIONS.map((a) => ({
        id: a.id,
        label: a.label,
        disabled: a.needsSelection && !hasSelection,
        onSelect: () => runAction(a.id),
      })),
    });
  }

  const size = SIZES[Math.max(0, Math.min(SIZES.length - 1, sizeIdx))];
  const words = liveStats.words;
  const chars = liveStats.chars;

  // The manuscript is applied with emitUpdate: false, so the editor never
  // tells us it changed. Recount whenever the document itself changes.
  useEffect(() => {
    setLiveStats(proseStats(doc));
  }, [doc]);

  const onReady = useCallback((h: EditorHandle) => {
    handleRef.current = h;
    // The selection bar subscribes to editor events, so it needs the instance
    // as state - a ref read during render would not re-render it into place.
    setEditor(h.editor);
    const text = h.getText();
    if (text.trim()) setLiveStats({ words: countWords(text), chars: text.length });
    onEditorReadyRef.current?.();
  }, []);

  function handleChange(next: PMDoc) {
    onChange(next);
    setLiveStats(proseStats(next));
  }

  applyQuoteRef.current = async (quote, instruction) => {
    const editor = handleRef.current?.editor;
    if (!hasFinal) return "missing";
    if (!editor) return "not-ready";
    const range = locateQuote(charsInDoc(editor.state.doc), quote);
    if (!range) return "missing";
    const docNode = editor.state.doc;
    const before = docNode.textBetween(Math.max(0, range.from - 500), range.from, "\n");
    const after = docNode.textBetween(range.to, Math.min(docNode.content.size, range.to + 500), "\n");
    const shown = docNode.textBetween(range.from, range.to, "\n");
    editor.chain().focus().setTextSelection(range).scrollIntoView().run();
    const preview = await api.previewConsequence(projectId, chapterNumber, {
      selection: shown,
      instruction,
      before_context: before,
      after_context: after,
    });
    editor.chain().focus().setTextSelection(range).insertContent(preview.rewritten).run();
    const nextDoc = editor.getJSON() as PMDoc;
    handleChange(nextDoc);
    const saved = await api.acceptConsequence(projectId, chapterNumber, {
      preview_id: preview.preview_id,
      rewritten: preview.rewritten,
      doc: nextDoc,
      state_delta: preview.state_delta,
    });
    handleChange(saved.final.doc as PMDoc);
    return "applied";
  };

  function openLink(nextMode: "link" | "create") {
    const sel = handleRef.current?.getSelection();
    setSeedName(sel?.quote.trim() || "");
    setLinkMode(nextMode);
    setLinkOpen(true);
  }

  function applyMention(entry: CodexEntry) {
    handleRef.current?.setCodexMention(entry.id, entry.entry_type);
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const item = await api.uploadMedia(projectId, file, "inline", file.name);
      insertImage(handleRef.current, api.mediaUrl(item), item.alt || file.name);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!hasFinal) {
    return (
      <div className="manuscript-page mx-auto max-w-[680px] px-11 py-14 text-center">
        <p className="font-display text-[20px] text-ink-text">Чистовика ещё нет</p>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-ink-muted">
          Чистовик — каноническая глава после вашей проверки. Перенесите последний этап ИИ,
          чтобы начать работу. Черновики останутся нетронутым источником.
        </p>
        <button
          type="button"
          onClick={onPromote}
          disabled={!canPromote || busy != null}
          className="btn-primary mt-6 disabled:opacity-40"
        >
          {busy === "promoting" ? "Переносим…" : canPromote ? `Перенести: ${promoteFrom} → Чистовик` : "Пока нечего переносить"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ ["--editor-size" as string]: `${size}rem` }} className="mx-auto">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-[12px] font-medium tracking-[-0.01em] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-ink" />
            Чистовик · {mode === "write" ? "Редактирование" : "Просмотр"}
          </span>
          <button type="button" onClick={onToggleFocus} className="btn-ghost" title="Режим фокуса">
            {focus ? "Выйти из фокуса" : "Фокус"}
          </button>
        </div>

        <div className="flex items-center gap-3 text-[12.5px] text-ink-muted">
          <span className="nums">{ruWords(words)} · {ruChars(chars)}</span>
          <span aria-live="polite" className="min-w-[78px] text-right">
            {busy === "saving" ? <span className="text-paper-muted">Сохраняем…</span>
              : dirty ? <span className="text-ink-muted">● Не сохранено</span>
              : <span className="text-st-approved">● {lastSaved ? `Сохранено ${lastSaved}` : "Сохранено"}</span>}
          </span>

          <div className="flex items-center overflow-hidden rounded-full border border-paper-line bg-[var(--color-surface-warm)]">
            <button type="button" onClick={() => setSizeIdx(Math.max(0, sizeIdx - 1))}
                    className="px-2.5 py-1 text-ink-muted hover:text-ink" aria-label="Уменьшить текст">A−</button>
            <button type="button" onClick={() => setSizeIdx(Math.min(SIZES.length - 1, sizeIdx + 1))}
                    className="border-l border-paper-line px-2.5 py-1 text-ink-muted hover:text-ink" aria-label="Увеличить текст">A+</button>
            <button type="button" onClick={() => setMeasure(measure === "wide" ? "narrow" : measure === "narrow" ? "normal" : "wide")}
                    className="border-l border-paper-line px-2.5 py-1 text-[11px] font-medium tracking-[-0.01em] text-ink-muted hover:text-ink"
                    title="Ширина колонки">{MEASURE_LABEL[measure]}</button>
            <div className="border-l border-paper-line pl-1">
              <ChoiceGroup
                label="Шрифт чтения"
                variant="segmented"
                size="sm"
                value={readerFont}
                onChange={(v) => chooseFont(v)}
                options={READER_FONTS.map((f) => ({
                  value: f.value,
                  label: f.label,
                  preview: (
                    <span
                      style={{
                        fontFamily:
                          f.value === "serif"
                            ? "var(--font-reader-serif)"
                            : f.value === "mono"
                              ? "var(--font-reader-mono)"
                              : "var(--font-reader-sans)",
                      }}
                    >
                      Aa
                    </span>
                  ),
                }))}
              />
            </div>
          </div>

          <div className="flex overflow-hidden rounded-full border border-paper-line bg-[var(--color-surface-warm)] p-0.5">
            {(["write", "preview"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                      className={`rounded-full px-3 py-1 text-[12.5px] font-medium capitalize transition-colors ${
                        mode === m ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"}`}>
                {m === "write" ? "Письмо" : "Просмотр"}
              </button>
            ))}
          </div>
          <button type="button" onClick={onSave} disabled={!dirty || busy != null}
                  className="btn-primary disabled:opacity-40">
            {busy === "saving" ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </div>

      {mode === "write" && (
        <div className="mb-2 flex items-center gap-1" style={{ maxWidth: MEASURES[measure], marginInline: "auto" }}>
          <TBtn onClick={() => toggleBold(handleRef.current)} label="Жирный"><b>B</b></TBtn>
          <TBtn onClick={() => toggleItalic(handleRef.current)} label="Курсив"><i>I</i></TBtn>
          <TBtn onClick={() => setHeading(handleRef.current, 2)} label="Заголовок">H</TBtn>
          <TBtn onClick={() => toggleBlockquote(handleRef.current)} label="Цитата">”</TBtn>
          <TBtn onClick={() => insertSceneBreak(handleRef.current)} label="Разрыв сцены">✦</TBtn>
          <div className="mx-1 h-5 w-px bg-paper-line" />
          <button
            type="button"
            aria-pressed={suggesting}
            onClick={() => setSuggesting(!suggesting)}
            title="Режим предложений — правки становятся отслеживаемыми"
            className={`rounded-lg px-2 py-1 text-[12px] font-medium transition ${
              suggesting
                ? "bg-[var(--color-violet)] text-white"
                : "text-ink-muted hover:bg-paper-line/60"
            }`}
          >
            Предложить
          </button>
          <div className="mx-1 h-5 w-px bg-paper-line" />
          <TBtn onClick={() => fileRef.current?.click()} label="Вставить изображение">
            {uploading ? "…" : "▣"}
          </TBtn>
          <TBtn
            onClick={() => {
              const sel = handleRef.current?.getSelection();
              if (sel) onCommentSelection?.(sel);
            }}
            label="Комментарий к выделению"
          >
            ¶
          </TBtn>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void pickImage(e.target.files?.[0])}
          />
        </div>
      )}

      <article
        className="manuscript-page px-11 py-12"
        style={{ maxWidth: MEASURES[measure], marginInline: "auto" }}
      >
        <div className="prose-manuscript" style={{ fontSize: `${size}rem` }}>
          <RichTextEditor
            doc={doc?.type === "doc" ? doc : EMPTY_DOC}
            onChange={handleChange}
            onReady={onReady}
            editable={mode === "write"}
            suggesting={suggesting}
            author={authorName}
            commentAnchors={commentAnchors}
            onContextMenu={(e) => {
              e.preventDefault();
              openActionMenu(e.clientX, e.clientY);
            }}
            onSelectionAction={(x, y) => openActionMenu(x, y)}
            onMentionClick={async (entryId, entryType, x, y) => {
              try {
                const list = await api.codex(projectId, entryType);
                const found = list.find((e) => e.id === entryId) ?? null;
                if (found) setEntity({ x, y, entry: found });
              } catch {
                /* ignore */
              }
            }}
          />
        </div>
      </article>

      <div style={{ maxWidth: MEASURES[measure], marginInline: "auto" }}>
        <SuggestionsPanel doc={doc?.type === "doc" ? doc : EMPTY_DOC} onChange={handleChange} />
      </div>

      {mode === "write" && (
        <SelectionBubble
          editor={editor}
          actions={BAR_ACTIONS}
          onSelect={runAction}
        />
      )}

      <ContextMenu
        open={ctx != null}
        x={ctx?.x ?? 0}
        y={ctx?.y ?? 0}
        items={ctx?.items ?? []}
        onClose={() => setCtx(null)}
      />

      <ConsequencePreviewModal
        open={rewriteOpen && rewriteSel != null}
        onClose={() => { setRewriteOpen(false); setRewriteSel(null); }}
        projectId={projectId}
        chapter={chapterNumber}
        selection={rewriteSel?.quote ?? ""}
        beforeContext={rewriteSel?.before ?? ""}
        afterContext={rewriteSel?.after ?? ""}
        initialInstruction={
          rewriteIntent === "expand"
            ? "Разверни этот момент. Сохрани мой голос и те же события."
            : rewriteInstruction
        }
        onAccept={acceptRewrite}
      />

      <LinkCodexModal
        projectId={projectId}
        open={linkOpen}
        mode={linkMode}
        seedName={seedName}
        onClose={() => setLinkOpen(false)}
        onLinked={applyMention}
      />

      <EntityPopover
        open={entity != null}
        x={entity?.x ?? 0}
        y={entity?.y ?? 0}
        entry={entity?.entry ?? null}
        projectId={projectId}
        onClose={() => setEntity(null)}
      />
    </div>
  );
});

export default FinalEditor;

function TBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-paper-line bg-paper-card text-[14px] text-ink-text transition-colors hover:bg-[var(--color-surface-warm)]">
      {children}
    </button>
  );
}
