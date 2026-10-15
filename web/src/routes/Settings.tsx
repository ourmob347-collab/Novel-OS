import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { api, type StudioLlmStatus, type StudioPreset } from "../api/client";
import Scene from "../components/Scene";
import Icon from "../components/Icon";
import { useToast } from "../components/toastContext";
import { Field, fieldClass } from "../components/Modal";

export default function Settings() {
  const toast = useToast();
  const [status, setStatus] = useState<StudioLlmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [autonomyModel, setAutonomyModel] = useState("anthropic/claude-haiku-5.5");
  const [busy, setBusy] = useState(false);

  function load() {
    api.studioLlm().then((s) => {
      setStatus(s);
      setModel(s.model || "");
      setAutonomyModel(s.autonomy_model || "anthropic/claude-haiku-5.5");
    }).catch((e) => setError(String(e)));
  }

  useEffect(() => { load(); }, []);

  async function applyPreset(p: StudioPreset) {
    setBusy(true);
    try {
      const next = await api.updateStudioLlm({
        preset: p.id,
        model: model.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
      });
      setStatus(next);
      setModel(next.model || "");
      setApiKey("");
      toast(`Пресет: ${p.label}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveAutonomy() {
    setBusy(true);
    try {
      const next = await api.updateStudioLlm({ autonomy_model: autonomyModel.trim() });
      setStatus(next);
      setAutonomyModel(next.autonomy_model || "anthropic/claude-haiku-5.5");
      toast("Модель автономной правки сохранена", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveCustom() {
    setBusy(true);
    try {
      const next = await api.updateStudioLlm({
        provider: status?.preset === "local" ? "ollama" : undefined,
        model: model.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
      });
      setStatus(next);
      setApiKey("");
      toast("Настройки сохранены", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scene>
      <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="glass-shell p-3 sm:p-4"
        >
          <div className="glass-panel px-6 py-8 sm:px-10 sm:py-10">
            <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-[var(--color-violet)]">
              <Icon name="arrow-left" className="h-3.5 w-3.5" /> Библиотека
            </Link>
            <p className="eyebrow">Студия</p>
            <h1 className="font-display text-[32px] font-semibold tracking-[-0.035em] text-ink-text">
              Настройки
            </h1>
            <p className="mt-2 max-w-xl text-[14px] text-ink-muted">
              Как агенты пишут. Novel OS не держит у себя модели для взрослого текста: для него берите «Локально» или «Без цензуры» со своим ключом.
            </p>

            {error && (
              <div className="mt-6 rounded-2xl border border-[rgba(200,80,100,0.3)] bg-[#fff5f7] px-4 py-3 text-[13px]">
                {error}
              </div>
            )}

            {status && (
              <>
                <div className={`mt-8 rounded-2xl border px-4 py-3 text-[13px] ${
                  status.configured
                    ? "border-[rgba(104,103,234,0.25)] bg-[rgba(238,237,255,0.6)] text-ink-text"
                    : "border-[rgba(200,122,27,0.3)] bg-[#fff8ee] text-ink-text"
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    <Icon name={status.configured ? "circle-check" : "triangle-alert"} className="h-4 w-4" />
                    {status.configured ? "Модель готова" : "Модель не настроена"}
                  </div>
                  <p className="mt-1 text-ink-muted">
                    {status.configured
                      ? `${status.provider} · ${status.model}`
                      : (status.error || "Добавьте ключ или выберите «Локально» (Ollama).")}
                  </p>
                </div>

                <h2 className="mt-10 mb-3 font-display text-[18px] font-semibold text-ink-text">Пресеты</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {status.presets.map((p) => {
                    const active = status.preset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={busy}
                        onClick={() => applyPreset(p)}
                        className={`rounded-2xl border p-4 text-left transition-all ${
                          active
                            ? "border-[rgba(104,103,234,0.45)] bg-[rgba(238,237,255,0.85)] shadow-[0_8px_24px_rgba(104,103,234,0.12)]"
                            : "border-[rgba(74,91,133,0.12)] bg-white/60 hover:border-[rgba(104,103,234,0.28)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] font-semibold text-ink-text">{p.label}</span>
                          {p.mature_capable && (
                            <span className="rounded-full bg-[#ffeaf1] px-2 py-0.5 text-[10px] font-medium text-[#c85177]">
                              18+
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">{p.hint}</p>
                        <p className="mt-2 text-[11px] text-paper-muted">{p.provider} · {p.model}</p>
                      </button>
                    );
                  })}
                </div>

                <h2 className="mt-10 mb-3 font-display text-[18px] font-semibold text-ink-text">Доступ</h2>
                <Field label="Идентификатор модели">
                  <input className={fieldClass} value={model} onChange={(e) => setModel(e.target.value)}
                         placeholder="например, claude-sonnet-4-6 или llama3.2" />
                </Field>
                <Field label="Ключ API (необязательно, пустое поле оставляет текущий)">
                  <input className={fieldClass} type="password" value={apiKey}
                         onChange={(e) => setApiKey(e.target.value)}
                         placeholder="sk-… или ключ OpenRouter" autoComplete="off" />
                </Field>
                <Field label="Базовый адрес (локально или свой)">
                  <input className={fieldClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                         placeholder="http://localhost:11434/v1" />
                </Field>
                <button type="button" disabled={busy} onClick={saveCustom} className="btn-primary mt-2 disabled:opacity-40">
                  {busy ? "Сохранение…" : "Сохранить доступ"}
                </button>

                <h2 className="mt-10 mb-3 font-display text-[18px] font-semibold text-ink-text">Автономная правка</h2>
                <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
                  Этой моделью студия сама правит темп и повторы. Письмо, правка и кнопка «Переписать» остаются на модели выше.
                </p>
                <Field label="Модель">
                  <input className={fieldClass} value={autonomyModel}
                         onChange={(e) => setAutonomyModel(e.target.value)}
                         placeholder="anthropic/claude-haiku-5.5" />
                </Field>
                <button type="button" disabled={busy || !autonomyModel.trim()} onClick={() => void saveAutonomy()}
                        className="btn-primary mt-2 disabled:opacity-40">
                  Сохранить модель правки
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </Scene>
  );
}
