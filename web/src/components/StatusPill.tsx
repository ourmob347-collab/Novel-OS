const STATUS_LABELS: Record<string, string> = {
  planned: "В плане",
  drafting: "Пишется",
  drafted: "Черновик",
  editing: "На правке",
  edited: "Отредактировано",
  validated: "Проверено",
  complete: "Готово",
  to_do: "К работе",
  proposed: "Предложено",
  in_review: "На проверке",
  final: "Чистовик",
  active: "Активно",
  resolved: "Закрыто",
  open: "Открыто",
};

function titleCase(status: string) {
  return status
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  const label = STATUS_LABELS[key.replace(/-/g, "_")] ?? titleCase(status);
  return (
    <span className="status-pill" data-status={key}>
      {label}
    </span>
  );
}
