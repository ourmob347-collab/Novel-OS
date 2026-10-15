import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../components/toastContext";

const LABELS: Record<string, string> = {
  plan_outline: "План",
  plan_chapter: "План главы",
  write: "Черновик",
  edit: "Правка",
  validate: "Проверка",
  approve: "Утверждение",
};

/**
 * Runs a pipeline stage as a background job and polls until it finishes.
 * `runningStage` reflects which stage is in flight (for per-button spinners).
 */
export function useRunPhase(projectId: string, onDone?: (stage: string) => void) {
  const toast = useToast();
  const [runningStage, setRunningStage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  async function run(stage: string, params: Record<string, unknown> = {}) {
    if (runningStage) return;
    setRunningStage(stage);
    try {
      const job = await api.runPhase(projectId, stage, params);
      timer.current = window.setInterval(async () => {
        try {
          const s = await api.getJob(job.job_id);
          if (s.status === "running") return;
          if (timer.current) window.clearInterval(timer.current);
          setRunningStage(null);
          if (s.status === "done") {
            toast(`${LABELS[stage] ?? stage} готов`, "success");
            onDone?.(stage);
          } else {
            toast(s.error ?? "Агент не смог закончить", "error");
          }
        } catch (e) {
          if (timer.current) window.clearInterval(timer.current);
          setRunningStage(null);
          toast(e instanceof Error ? e.message : String(e), "error");
        }
      }, 1200);
    } catch (e) {
      setRunningStage(null);
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return { run, runningStage, isRunning: runningStage != null, label: LABELS };
}
