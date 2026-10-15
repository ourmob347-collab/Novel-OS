"""
Novel OS - Deterministic Continuity Engine

Runs FAST, FREE local checks before (and after) the LLM Continuity Guardian.
These catch the obvious errors no API call should ever be spent on, and surface
structured findings the Guardian agent can use as starting context.

Categories of checks:
  - dormant plot threads
  - unresolved foreshadowing past its target chapter
  - long-absent named characters
  - chapter file/status mismatches
  - characters appearing after a flagged death
  - plot threads marked active past their target_resolution_chapter
  - missing required character fields
  - orphan / self relationship edges
  - hostile pairs co-present in a chapter
  - relationship since_chapter anachronism
  - contradictory bonds (e.g. enemy + romantic)
  - dead character co-present with a living bonded partner
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field, asdict
from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Set, TYPE_CHECKING

if TYPE_CHECKING:
    from state_manager import StoryState


# Tunables keep conservative to avoid false positives.
DORMANT_THREAD_GAP_CHAPTERS = 3
ABSENT_CHARACTER_GAP_CHAPTERS = 5
DEAD_KEYWORDS = ("dead", "killed", "deceased", "died")

_ROLE_RU = {
    "protagonist": "протагонист",
    "antagonist": "антагонист",
    "supporting": "второстепенный",
    "minor": "эпизодический",
}
_STATUS_RU = {
    "planned": "в плане",
    "drafting": "пишется",
    "drafted": "черновик",
    "editing": "на правке",
    "edited": "отредактировано",
    "validated": "проверено",
    "complete": "готово",
}
_BOND_RU = {
    "ally": "союзник",
    "rival": "соперник",
    "family": "семья",
    "romantic": "роман",
    "mentor": "наставник",
    "enemy": "враг",
    "owes debt": "должен",
    "secret": "тайна",
    "unknown": "неясно",
}


def _ru(table: dict, value: str) -> str:
    key = (value or "").strip().lower()
    return table.get(key, value)


# --------------------------------------------------------------------- Finding

@dataclass
class Finding:
    severity: str          # "critical" | "warning" | "info"
    category: str          # short tag, e.g. "dormant_thread"
    message: str
    suggestion: str = ""
    chapter: Optional[int] = None
    entity_id: Optional[str] = None  # character_id, thread_id, etc.

    @property
    def key(self) -> str:
        """Stable identity for the *fact* this finding is about.

        Deliberately excludes the message and the chapter. The message gets
        reworded as checks improve, and the same contradiction surfaces at
        whichever chapter it is next observed - keying on either would silently
        resurrect a dismissal the writer already made.
        """
        return f"{self.category}:{self.entity_id or ''}"

    def format(self) -> str:
        head = f"[{self.severity.upper()}] {self.category}"
        if self.chapter is not None:
            head += f" (ch{self.chapter})"
        body = f"  {self.message}"
        tail = f"  -> {self.suggestion}" if self.suggestion else ""
        return "\n".join(p for p in (head, body, tail) if p)

    def to_dict(self) -> dict:
        return {**asdict(self), "key": self.key}


# --------------------------------------------------------------------- checks

def _current_chapter(state: "StoryState") -> int:
    """The highest-numbered chapter that is at least drafted; 0 if none."""
    drafted = [
        c.number for c in state.chapters.values()
        if c.status in ("drafted", "editing", "edited", "validated", "complete")
    ]
    return max(drafted) if drafted else 0


def check_dormant_threads(state: "StoryState", as_of_chapter: Optional[int] = None) -> List[Finding]:
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    out: List[Finding] = []
    for thread in state.plot_threads.values():
        if thread.status != "active":
            continue
        last_seen = thread.last_updated_chapter or thread.start_chapter or 0
        gap = cur - last_seen
        if gap > DORMANT_THREAD_GAP_CHAPTERS:
            out.append(Finding(
                severity="warning",
                category="dormant_thread",
                message=f"Нить «{thread.name}» (приоритет {thread.priority}) "
                        f"не двигалась {gap} глав (последний раз — гл. {last_seen}).",
                suggestion="Заденьте нить в следующей главе или закройте её.",
                chapter=cur,
                entity_id=thread.id,
            ))
    return out


def check_overdue_threads(state: "StoryState", as_of_chapter: Optional[int] = None) -> List[Finding]:
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    out: List[Finding] = []
    for thread in state.plot_threads.values():
        if thread.status != "active":
            continue
        target = thread.target_resolution_chapter
        if target and cur > target:
            out.append(Finding(
                severity="critical",
                category="overdue_thread",
                message=f"Нить «{thread.name}» должна была закрыться к гл. {target}, "
                        f"сейчас глава {cur}, а нить всё ещё открыта.",
                suggestion="Закройте нить, бросьте её или сдвиньте срок.",
                chapter=cur,
                entity_id=thread.id,
            ))
    return out


def check_unresolved_foreshadowing(state: "StoryState", as_of_chapter: Optional[int] = None) -> List[Finding]:
    """Foreshadowing planted in early chapters but never matched by a 'resolved' note."""
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    resolved_all: set = set()
    for ch in state.chapters.values():
        for r in ch.foreshadowing_resolved:
            resolved_all.add(r.strip().lower())
    out: List[Finding] = []
    for ch in sorted(state.chapters.values(), key=lambda c: c.number):
        if ch.number > cur:
            continue
        gap = cur - ch.number
        if gap < DORMANT_THREAD_GAP_CHAPTERS:
            continue
        for fs in ch.foreshadowing_planted:
            key = fs.strip().lower()
            if key in resolved_all:
                continue
            # Loose match: any resolved entry contains the planted snippet (or vice versa)
            if any(key in r or r in key for r in resolved_all):
                continue
            out.append(Finding(
                severity="warning",
                category="unresolved_foreshadowing",
                message=f"Предвестие из гл. {ch.number} ещё не закрыто "
                        f"(прошло глав: {gap}): {fs[:80]}",
                suggestion="Закройте его, напомните о нём или отметьте «так задумано».",
                chapter=ch.number,
            ))
    return out


def check_absent_characters(state: "StoryState", as_of_chapter: Optional[int] = None) -> List[Finding]:
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    out: List[Finding] = []
    for char in state.characters.values():
        if char.role in ("minor",):
            continue
        if char.last_appearance_chapter == 0:
            # Never seen flag only if they're a main role
            if char.role in ("protagonist", "antagonist"):
                out.append(Finding(
                    severity="warning",
                    category="never_appeared",
                    message=f"{char.full_name} ({_ru(_ROLE_RU, char.role)}) ещё не появлялся ни в одной главе.",
                    suggestion="Выведите персонажа или понизьте роль.",
                    entity_id=char.id,
                ))
            continue
        gap = cur - char.last_appearance_chapter
        if gap > ABSENT_CHARACTER_GAP_CHAPTERS:
            out.append(Finding(
                severity="warning",
                category="absent_character",
                message=f"{char.full_name} ({_ru(_ROLE_RU, char.role)}) не появлялся {gap} глав "
                        f"(последний раз — гл. {char.last_appearance_chapter}).",
                suggestion="Верните персонажа, упомяните его или зафиксируйте отсутствие.",
                chapter=cur,
                entity_id=char.id,
            ))
    return out


def check_dead_characters_reappearing(state: "StoryState") -> List[Finding]:
    out: List[Finding] = []
    for char in state.characters.values():
        es = (char.emotional_state or "").lower()
        notes = (char.notes or "").lower()
        died_marker = any(k in es or k in notes for k in DEAD_KEYWORDS)
        if not died_marker:
            continue
        # If they have any later location update or "appears", flag.
        # We can't know the death chapter precisely; conservative: warn if last_appearance > 0.
        out.append(Finding(
            severity="warning",
            category="dead_character_state",
            message=f"{char.full_name} отмечен как мёртвый, но состояние всё ещё считает его "
                    f"действующим (последний раз — гл. {char.last_appearance_chapter}).",
            suggestion="Если воскрешение или флешбэк задуманы, запишите это; иначе поставьте роль «эпизодический» и заморозьте состояние.",
            entity_id=char.id,
        ))
    return out


def check_chapter_file_consistency(state: "StoryState", project_path: Path) -> List[Finding]:
    """Mismatches between chapter.status and what files exist on disk."""
    out: List[Finding] = []
    manuscript = project_path / "outputs" / "manuscript"
    for ch in state.chapters.values():
        draft = manuscript / f"chapter_{ch.number:03d}_draft.md"
        revised = manuscript / f"chapter_{ch.number:03d}_revised.md"
        has_draft = draft.exists()
        has_revised = revised.exists()
        if ch.status in ("complete", "validated", "edited") and not (has_draft or has_revised):
            out.append(Finding(
                severity="critical",
                category="missing_chapter_file",
                message=f"Глава {ch.number}: статус «{_ru(_STATUS_RU, ch.status)}», а файла черновика или правки нет.",
                suggestion="Запустите письмо или правку снова либо поправьте статус.",
                chapter=ch.number,
            ))
        if ch.status == "planned" and has_draft:
            out.append(Finding(
                severity="info",
                category="status_drift",
                message=f"У главы {ch.number} есть файл черновика, а статус всё ещё «в плане».",
                suggestion="Поставьте статус «черновик».",
                chapter=ch.number,
            ))
    return out


def check_required_character_fields(state: "StoryState") -> List[Finding]:
    out: List[Finding] = []
    for char in state.characters.values():
        if char.role in ("protagonist", "antagonist") and not char.internal_desire:
            out.append(Finding(
                severity="info",
                category="thin_character",
                message=f"У {char.full_name} ({_ru(_ROLE_RU, char.role)}) не задано внутреннее желание.",
                suggestion="Протагонист или антагонист без внутреннего желания держится слабо.",
                entity_id=char.id,
            ))
    return out


_HOSTILE_LABELS = frozenset({
    "enemy", "enemies", "rival", "rivals", "hostile", "nemesis", "foe",
})

_INTIMATE_LABELS = frozenset({
    "romantic", "lovers", "married", "spouse", "dating", "intimate", "ally", "allies",
    "family", "siblings", "friends", "best friends",
})


def _present_ids_for_chapter(state: "StoryState", cur: int) -> Set[str]:
    chapter = state.chapters.get(cur)
    if not chapter:
        return set()
    present_raw = [p.strip().lower() for p in (chapter.characters_present or []) if p.strip()]
    name_to_id = {
        c.full_name.strip().lower(): c.id for c in state.characters.values()
    }
    present_ids = {name_to_id[n] for n in present_raw if n in name_to_id}
    if chapter.pov_character:
        pov_id = name_to_id.get(chapter.pov_character.strip().lower())
        if pov_id:
            present_ids.add(pov_id)
    return present_ids


def _is_dead_character(char) -> bool:
    es = (char.emotional_state or "").lower()
    notes = (char.notes or "").lower()
    role = (char.role or "").lower()
    return any(k in es or k in notes or k in role for k in DEAD_KEYWORDS)


def check_relationship_integrity(state: "StoryState") -> List[Finding]:
    """Orphan / broken relationship edges in the Codex graph."""
    known = set(state.characters) | set(getattr(state, "codex", {}) or {})
    out: List[Finding] = []
    for edge in getattr(state, "relationships", {}).values():
        if edge.source_id == edge.target_id:
            out.append(Finding(
                severity="warning",
                category="relationship_self",
                message=f"Связь «{_ru(_BOND_RU, edge.label)}» замыкает запись на саму себя ({edge.source_id}).",
                suggestion="Удалите эту связь.",
                entity_id=edge.id,
            ))
            continue
        missing = [eid for eid in (edge.source_id, edge.target_id) if eid not in known]
        if missing:
            out.append(Finding(
                severity="warning",
                category="relationship_orphan",
                message=f"Связь «{_ru(_BOND_RU, edge.label)}» ссылается на отсутствующие записи Кодекса: {', '.join(missing)}.",
                suggestion="Удалите связь или верните недостающую запись.",
                entity_id=edge.id,
            ))
    return out


def check_hostile_pairs_co_present(
    state: "StoryState", as_of_chapter: Optional[int] = None,
) -> List[Finding]:
    """Warn when enemy/rival pairs share a chapter cast without an edge update."""
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    present_ids = _present_ids_for_chapter(state, cur)
    if len(present_ids) < 2:
        return []

    out: List[Finding] = []
    for edge in getattr(state, "relationships", {}).values():
        if edge.status not in ("", "active"):
            continue
        label = (edge.label or "").strip().lower()
        if label not in _HOSTILE_LABELS:
            continue
        pair = {edge.source_id, edge.target_id}
        if not pair <= present_ids:
            continue
        a = state.characters.get(edge.source_id)
        b = state.characters.get(edge.target_id)
        an = a.full_name if a else edge.source_id
        bn = b.full_name if b else edge.target_id
        out.append(Finding(
            severity="warning",
            category="hostile_co_presence",
            message=f"{an} и {bn} оба в главе {cur}, а Кодекс всё ещё "
                    f"помечает их как «{_ru(_BOND_RU, edge.label)}».",
            suggestion="Обновите связь на схеме или подтвердите, что вражда задумана.",
            chapter=cur,
            entity_id=edge.id,
        ))
    return out


def check_relationship_since_anachronism(
    state: "StoryState", as_of_chapter: Optional[int] = None,
) -> List[Finding]:
    """Warn when a bond's since_chapter is after the chapter where both are already present."""
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    present_ids = _present_ids_for_chapter(state, cur)
    if len(present_ids) < 2:
        return []
    out: List[Finding] = []
    for edge in getattr(state, "relationships", {}).values():
        since = int(getattr(edge, "since_chapter", 0) or 0)
        if since <= 0 or since <= cur:
            continue
        if edge.status not in ("", "active"):
            continue
        pair = {edge.source_id, edge.target_id}
        if not pair <= present_ids:
            continue
        a = state.characters.get(edge.source_id)
        b = state.characters.get(edge.target_id)
        an = a.full_name if a else edge.source_id
        bn = b.full_name if b else edge.target_id
        out.append(Finding(
            severity="warning",
            category="relationship_since_anachronism",
            message=f"Глава {cur} сводит {an} и {bn} как «{_ru(_BOND_RU, edge.label)}», "
                    f"но связь помечена с главы {since}.",
            suggestion="Сдвиньте начало связи раньше или не сводите их в одной сцене до той главы.",
            chapter=cur,
            entity_id=edge.id,
        ))
    return out


def check_contradictory_relationships(state: "StoryState") -> List[Finding]:
    """Warn when the same pair has both hostile and intimate active edges."""
    by_pair: dict[tuple[str, str], list] = {}
    for edge in getattr(state, "relationships", {}).values():
        if edge.status not in ("", "active"):
            continue
        key = tuple(sorted((edge.source_id, edge.target_id)))
        by_pair.setdefault(key, []).append(edge)

    out: List[Finding] = []
    for (aid, bid), edges in by_pair.items():
        labels = {(e.label or "").strip().lower() for e in edges}
        hostile = labels & _HOSTILE_LABELS
        intimate = labels & _INTIMATE_LABELS
        if not (hostile and intimate):
            continue
        a = state.characters.get(aid)
        b = state.characters.get(bid)
        an = a.full_name if a else aid
        bn = b.full_name if b else bid
        out.append(Finding(
            severity="warning",
            category="relationship_contradiction",
            message=f"У {an} и {bn} противоречат друг другу действующие связи: "
                    f"{', '.join(_ru(_BOND_RU, x) for x in sorted(hostile))} и {', '.join(_ru(_BOND_RU, x) for x in sorted(intimate))}.",
            suggestion="Разведите это на схеме: оставьте одну связь или закройте лишнюю.",
            entity_id=edges[0].id,
        ))
    return out


def check_dead_bonded_co_presence(
    state: "StoryState", as_of_chapter: Optional[int] = None,
) -> List[Finding]:
    """Critical when a dead-flagged character shares a scene with a living partner."""
    cur = as_of_chapter if as_of_chapter is not None else _current_chapter(state)
    if cur == 0:
        return []
    present_ids = _present_ids_for_chapter(state, cur)
    if not present_ids:
        return []
    out: List[Finding] = []
    for edge in getattr(state, "relationships", {}).values():
        if edge.status not in ("", "active"):
            continue
        pair = {edge.source_id, edge.target_id}
        if not pair <= present_ids:
            continue
        for cid in pair:
            char = state.characters.get(cid)
            if not char or not _is_dead_character(char):
                continue
            other_id = next(iter(pair - {cid}))
            other = state.characters.get(other_id)
            on = other.full_name if other else other_id
            out.append(Finding(
                severity="critical",
                category="dead_character_co_presence",
                message=f"{char.full_name} отмечен как мёртвый, но в главе {cur} "
                        f"рядом с {on} (связь «{_ru(_BOND_RU, edge.label)}»).",
                suggestion="Пометьте сцену как флешбэк или воскрешение в заметках либо уберите персонажа из состава.",
                chapter=cur,
                entity_id=edge.id,
            ))
    return out


# --------------------------------------------------------------------- runners

def _check_stalled_middle(state: "StoryState",
                          as_of_chapter: Optional[int] = None) -> List[Finding]:
    """Sagging-middle detection (design spec §4.3). Thin delegate so the
    detector can be developed and tested on its own."""
    from stall_detector import check_stalled_middle

    return check_stalled_middle(state, as_of_chapter)


ALL_CHECKS = (
    check_dormant_threads,
    check_overdue_threads,
    check_unresolved_foreshadowing,
    check_absent_characters,
    check_dead_characters_reappearing,
    check_required_character_fields,
    check_relationship_integrity,
    check_hostile_pairs_co_present,
    check_relationship_since_anachronism,
    check_contradictory_relationships,
    check_dead_bonded_co_presence,
    _check_stalled_middle,
)


@lru_cache(maxsize=None)
def _takes_as_of_chapter(check) -> bool:
    """True when `check` accepts the as_of_chapter argument."""
    return "as_of_chapter" in inspect.signature(check).parameters


def run_all(state: "StoryState", project_path: Optional[Path] = None,
            as_of_chapter: Optional[int] = None) -> List[Finding]:
    """Run every check that applies. project_path enables file-consistency checks."""
    out: List[Finding] = []
    for check in ALL_CHECKS:
        # Some checks take only `state`. Decide from the signature rather than
        # by catching TypeError: a TypeError raised *inside* a two-arg check
        # would otherwise silently re-run it against the default chapter and
        # report findings for the wrong point in the story.
        if _takes_as_of_chapter(check):
            out.extend(check(state, as_of_chapter))  # type: ignore[arg-type]
        else:
            out.extend(check(state))  # type: ignore[arg-type]
    if project_path is not None:
        out.extend(check_chapter_file_consistency(state, project_path))
    return drop_exempt(state, out)


def drop_exempt(state: "StoryState", findings: List[Finding]) -> List[Finding]:
    """Remove findings the writer has marked intentional.

    Applied inside `run_all`, so every consumer - the panel, the CLI summary and
    the Guardian's prompt - agrees about what counts as a problem. Filtering in
    the UI alone would leave the AI arguing with a decision the human already
    made.
    """
    exempt = getattr(state, "continuity_exemptions", None) or {}
    if not exempt:
        return findings
    return [f for f in findings if f.key not in exempt]


def summarize(findings: List[Finding]) -> str:
    if not findings:
        return "✅ continuity engine: no findings."
    by_severity = {"critical": [], "warning": [], "info": []}
    for f in findings:
        by_severity.setdefault(f.severity, []).append(f)
    lines = [
        f"continuity engine: {len(findings)} finding(s) "
        f"({len(by_severity['critical'])} critical, "
        f"{len(by_severity['warning'])} warning, "
        f"{len(by_severity['info'])} info)\n"
    ]
    for sev in ("critical", "warning", "info"):
        for f in by_severity.get(sev, []):
            lines.append(f.format())
            lines.append("")
    return "\n".join(lines).rstrip()


def to_context_block(findings: List[Finding]) -> str:
    """Render findings as a context block to inject into the LLM Guardian's prompt."""
    if not findings:
        return "Deterministic pre-check: no automated findings.\n"
    lines = ["Deterministic pre-check findings (verify and incorporate into your report):", ""]
    for f in findings:
        head = f"- [{f.severity.upper()}] {f.category}"
        if f.chapter is not None:
            head += f" ch{f.chapter}"
        lines.append(head + ": " + f.message)
        if f.suggestion:
            lines.append(f"  suggestion: {f.suggestion}")
    return "\n".join(lines) + "\n"
