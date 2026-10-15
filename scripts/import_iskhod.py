"""Import project 12 «Исход нового мира» into Novel OS as project iskhod.

Reads the book database. Does not write back to it. Rebuilds the Novel OS
project and drops the earlier partial import story-12.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "core"))

from document_tree import (  # noqa: E402
    MANUSCRIPT_ID,
    SCENE,
    Binder,
    DocumentNode,
    chapter_id,
    scene_id,
)
from state_manager import (  # noqa: E402
    Character,
    ChapterState,
    CodexEntry,
    PlotThread,
    RelationshipEdge,
    StoryState,
    StyleProfile,
    initialize_project,
)

PROJECT_ID = "iskhod"
TITLE = "Исход нового мира"
GENRE = "РеалРПГ, зомби-апокалипсис"
PARTIAL_ID = "story-12"
DB_CONTAINER = "ai-multi-agent-writer-database-1"
POV = "Иван"

PRIORITY = {"primary": 5, "secondary": 3, "background": 1}
THREAD_STATUS = {"open": "active", "promised": "active"}
BOND = {"enemy_of": "enemy"}


def query(sql: str):
    wrapped = f"SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM ({sql}) q"
    proc = subprocess.run(
        [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-U", "app", "-d", "app", "-t", "-A", "-v", "ON_ERROR_STOP=1",
            "-c", wrapped,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


def one(sql: str) -> dict:
    rows = query(sql)
    if len(rows) != 1:
        raise SystemExit(f"expected 1 row, got {len(rows)} for {sql[:80]}")
    return rows[0]


def words(text: str) -> int:
    return len(text.split()) if text and text.strip() else 0


def signs_to_words(signs: int) -> int:
    return max(1, round(int(signs or 0) / 6))


def budget_line(signs: int) -> str:
    return f"Бюджет: {int(signs):,} знаков.".replace(",", " ")


def slug_id(prefix: str, n: int) -> str:
    return f"{prefix}-{n:03d}"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")


def claim(project_id: str) -> None:
    db_path = ROOT / "novel_os.db"
    con = sqlite3.connect(db_path)
    tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    table = "projectownership" if "projectownership" in tables else None
    if table is None:
        raise SystemExit(f"no project ownership table in {db_path}: {sorted(tables)}")
    now = datetime.now().isoformat(timespec="seconds")
    con.execute(f"DELETE FROM {table} WHERE project_id = ?", (PARTIAL_ID,))
    con.execute(
        f"INSERT INTO {table} (project_id, workspace_id, created_at) VALUES (?, 'default', ?) "
        f"ON CONFLICT(project_id) DO UPDATE SET workspace_id = 'default'",
        (project_id, now),
    )
    con.commit()
    con.close()


def thread_titles(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = json.loads(raw)
    return [item.get("title", "") for item in raw if isinstance(item, dict) and item.get("title")]


def main() -> None:
    project = one("SELECT * FROM project WHERE id = 12")
    volumes = query(
        "SELECT * FROM story_volume WHERE project_id = 12 ORDER BY volume_number"
    )
    chapters = query(
        """
        SELECT c.*, b.title AS beat_title, b.description AS beat_description, b.act AS beat_act,
               v.volume_number
        FROM story_chapter c
        JOIN story_volume v ON v.id = c.volume_id
        LEFT JOIN story_beat b ON b.id = c.beat_id
        WHERE c.project_id = 12
        ORDER BY v.volume_number, c.chapter_number
        """
    )
    scenes = query(
        """
        SELECT s.*, c.chapter_number
        FROM story_scene_outline s
        JOIN story_chapter c ON c.id = s.chapter_id
        WHERE s.project_id = 12
        ORDER BY c.chapter_number, s.sort_order
        """
    )
    characters = query("SELECT * FROM story_character WHERE project_id = 12 ORDER BY name")
    locations = query("SELECT * FROM story_location WHERE project_id = 12 ORDER BY name")
    factions = query("SELECT * FROM story_faction WHERE project_id = 12 ORDER BY name")
    territories = query("SELECT * FROM story_territory WHERE project_id = 12 ORDER BY name")
    lore = query("SELECT * FROM lore_fact WHERE project_id = 12 ORDER BY topic")
    relations = query("SELECT * FROM story_relation WHERE project_id = 12 ORDER BY id")
    threads = query("SELECT * FROM plot_thread WHERE project_id = 12 ORDER BY title")
    patches = query(
        """
        SELECT p.*, c.chapter_number
        FROM canon_patch_line p
        LEFT JOIN story_chapter c ON c.id = p.chapter_id
        WHERE p.project_id = 12
        ORDER BY p.status, p.type, p.name
        """
    )
    revisions = query(
        """
        SELECT r.id, r.body, r.source, r.action, r.created_at, c.chapter_number
        FROM chapter_revision r
        JOIN story_chapter c ON c.id = r.chapter_id
        WHERE c.project_id = 12
        ORDER BY c.chapter_number, r.id
        """
    )

    projects = ROOT / "projects"
    partial = projects / PARTIAL_ID
    if partial.exists():
        shutil.rmtree(partial)
    dest = projects / PROJECT_ID
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    state = initialize_project(str(dest), TITLE, GENRE)
    state.set_metadata("genres", ["РеалРПГ", "зомби-апокалипсис"])
    state.set_metadata("premise", project["global_premise"] or "")
    state.set_metadata("source", "ai-multi-agent-writer project 12")
    series_chars = sum(int(v["target_char_count"] or 0) for v in volumes)
    state.set_metadata("target_word_count", signs_to_words(series_chars))
    state.set_metadata("target_char_count", series_chars)

    state.story_bible = {
        "genre": GENRE,
        "premise": project["global_premise"] or "",
        "annotation": project["annotation"] or "",
        "series_question": project["series_question"] or "",
        "series_macro_arc": project["series_macro_arc"] or "",
        "series_theme_spine": project["series_theme_spine"] or "",
        "world_design_notes": project["world_design_notes"] or "",
        "series_architecture": project["series_architecture_notes"] or "",
        "tone": "серьёзный",
        "setting": {
            "time_period": "сразу после появления Системы",
            "primary_location": "Петербургский метрополитен",
            "world_rules": "см. Кодекс, раздел «мир»",
        },
        "pov": "third_limited",
        "tense": "past",
    }
    state.style_profile = StyleProfile(
        name="Исход нового мира",
        description="Проза от третьего лица, прошедшее время, рядом с Иваном.",
        tone="serious",
        point_of_view="third_limited",
        tense="past",
        prose_style="cinematic",
        chapter_target_words=signs_to_words(18000),
        genre_conventions=["РеалРПГ", "зомби-апокалипсис"],
    )

    by_name: dict[str, str] = {}

    def remember(name: str, entry_id: str) -> None:
        by_name[name.strip().lower()] = entry_id

    # Stable order: Иван first so char-001 is the protagonist.
    characters.sort(key=lambda c: (c["name"] != "Иван", c["name"]))
    for i, row in enumerate(characters, start=1):
        role = "protagonist" if row["name"] == "Иван" else "supporting"
        notes = (row["short_description"] or "").strip()
        if row.get("bio"):
            notes = f"{notes}\n\n{row['bio'].strip()}".strip()
        aliases = row.get("aliases") or []
        if isinstance(aliases, str):
            aliases = json.loads(aliases)
        if aliases:
            notes += "\n\nТакже: " + ", ".join(aliases)
        cid = slug_id("char", i)
        state.characters[cid] = Character(
            id=cid,
            full_name=row["name"],
            role=role,
            notes=notes,
            last_appearance_chapter=6 if row["name"] == "Иван" else 0,
        )
        remember(row["name"], cid)

    n_loc = 0
    for row in locations:
        n_loc += 1
        eid = slug_id("loc", n_loc)
        notes = (row.get("description") or "").strip()
        aliases = row.get("aliases") or []
        if isinstance(aliases, str):
            aliases = json.loads(aliases)
        if aliases:
            notes = (notes + "\n\nТакже: " + ", ".join(aliases)).strip()
        state.codex[eid] = CodexEntry(
            id=eid,
            entry_type="location",
            name=row["name"],
            summary=(row.get("short_description") or "").strip(),
            notes=notes,
            tags=["место"],
        )
        remember(row["name"], eid)

    for row in territories:
        n_loc += 1
        eid = slug_id("loc", n_loc)
        bits = []
        if row.get("kind"):
            bits.append(f"Вид: {row['kind']}")
        if row.get("parent_name"):
            bits.append(f"Входит в: {row['parent_name']}")
        if row.get("population"):
            bits.append(f"Население: {row['population']}")
        if row.get("climate"):
            bits.append(f"Климат: {row['climate']}")
        tags = ["территория"]
        extra = row.get("tags") or []
        if isinstance(extra, str):
            extra = json.loads(extra)
        aliases = row.get("aliases") or []
        if isinstance(aliases, str):
            aliases = json.loads(aliases)
        if aliases:
            bits.append("Также: " + ", ".join(aliases))
        state.codex[eid] = CodexEntry(
            id=eid,
            entry_type="location",
            name=row["name"],
            summary=(row.get("short_description") or "").strip(),
            notes="\n".join(bits),
            tags=tags + [str(t) for t in extra],
        )
        remember(row["name"], eid)

    n_world = 0
    for row in factions:
        n_world += 1
        eid = slug_id("wor", n_world)
        bits = []
        if row.get("ideology"):
            bits.append(row["ideology"].strip())
        if row.get("notes"):
            bits.append(row["notes"].strip())
        aliases = row.get("aliases") or []
        if isinstance(aliases, str):
            aliases = json.loads(aliases)
        if aliases:
            bits.append("Также: " + ", ".join(aliases))
        state.codex[eid] = CodexEntry(
            id=eid,
            entry_type="worldbuilding",
            name=row["name"],
            summary=(row.get("short_description") or "").strip(),
            notes="\n\n".join(bits),
            tags=["фракция"],
        )
        remember(row["name"], eid)

    n_item = 0
    for row in lore:
        topic = row["topic"]
        tags = row.get("tags") or []
        if isinstance(tags, str):
            tags = json.loads(tags)
        content = (row.get("content") or "").strip()
        if topic.startswith("Острый край"):
            n_item += 1
            eid = slug_id("ite", n_item)
            entry_type = "item"
            entry_tags = ["предмет"] + [str(t) for t in tags]
        else:
            n_world += 1
            eid = slug_id("wor", n_world)
            entry_type = "worldbuilding"
            entry_tags = ["правило"] + [str(t) for t in tags]
        state.codex[eid] = CodexEntry(
            id=eid,
            entry_type=entry_type,
            name=topic,
            summary=content[:320],
            notes=content,
            tags=entry_tags,
        )
        remember(topic, eid)

    for i, row in enumerate(threads, start=1):
        tid = slug_id("thread", i)
        original = row["status"] or "open"
        state.plot_threads[tid] = PlotThread(
            id=tid,
            name=row["title"],
            description=(row.get("description") or "").strip()
            + f"\n\nСтатус в книге: {original}. Выплата: том {row.get('payoff_volume') or '—'}.",
            thread_type="main" if row.get("priority") == "primary" else "subplot",
            status=THREAD_STATUS.get(original, "active"),
            priority=PRIORITY.get(row.get("priority") or "", 1),
            start_chapter=0,
            related_characters=[by_name["иван"]] if "иван" in by_name else [],
        )
        remember(row["title"], tid)

    touches: dict[str, list[int]] = {t["title"]: [] for t in threads}
    scenes_by_chapter: dict[int, list[dict]] = {}
    for scene in scenes:
        scenes_by_chapter.setdefault(int(scene["chapter_number"]), []).append(scene)

    binder = Binder()
    volume_nodes: dict[int, DocumentNode] = {}
    for vol in volumes:
        number = int(vol["volume_number"])
        part_id = MANUSCRIPT_ID if number == 1 else f"part-vol-{number:02d}"
        synopsis = "\n".join([
            f"Том {number}. Статус в книге: {vol['status']}.",
            f"Тема: {(vol.get('theme') or '').strip()}",
            f"Конфликт: {(vol.get('core_conflict') or '').strip()}",
            f"На входе: {(vol.get('opening_state') or '').strip()}",
            f"На выходе: {(vol.get('closing_state') or '').strip()}",
            budget_line(vol["target_char_count"]),
            f"Глав в плане: {vol.get('target_chapter_count') or '—'}.",
        ])
        node = binder.add(DocumentNode(
            id=part_id,
            type="part",
            title=vol["title"],
            synopsis=synopsis,
            target_words=signs_to_words(vol["target_char_count"]),
            label=vol["status"] or "",
        ))
        volume_nodes[number] = node

    prose_chapters = 0
    scene_count = 0
    for row in chapters:
        if int(row["volume_number"]) != 1:
            continue
        number = int(row["chapter_number"])
        body = row.get("body") or ""
        work = row.get("work_state") or "idle"
        if work == "finished" and body.strip():
            status = "complete"
        elif work == "writing" and body.strip():
            status = "drafted"
        else:
            status = "planned"
            body = ""
        if body.strip():
            prose_chapters += 1
        chapter_scenes = []
        for scene in scenes_by_chapter.get(number, []):
            summary = (scene.get("description") or "").strip()
            summary = f"{summary}\n\n{budget_line(scene['target_char_count'])}".strip()
            chapter_scenes.append({
                "title": scene["title"],
                "summary": summary,
                "pov": POV,
            })
        scene_count += len(chapter_scenes)
        target_signs = int(row["target_char_count"] or 0)
        linked = thread_titles(row.get("linked_threads"))
        for title in linked:
            touches.setdefault(title, []).append(number)
        ch = ChapterState(
            number=number,
            title=row["title"],
            status=status,
            pov_character=POV,
            word_count=words(body),
            target_word_count=signs_to_words(target_signs),
            scenes=chapter_scenes,
            characters_present=[by_name["иван"]] if body.strip() and "иван" in by_name else [],
        )
        state.chapters[number] = ch

        keywords = []
        if row.get("beat_title"):
            keywords.append(row["beat_title"])
        synopsis = (row.get("synopsis") or "").strip()
        extra = [budget_line(target_signs)]
        if linked:
            extra.append("Нити: " + ", ".join(f"«{name}»" for name in linked))
        if row.get("beat_title"):
            extra.append(f"Бит: {row['beat_title']}")
        synopsis = synopsis + "\n\n" + " ".join(extra)

        parent = volume_nodes[1]
        node = binder.add(DocumentNode(
            id=chapter_id(number),
            type="chapter",
            title=row["title"],
            chapter_number=number,
            synopsis=synopsis.strip(),
            status="to_do",
            pov=POV,
            target_words=signs_to_words(target_signs),
            word_count=words(body),
            keywords=keywords,
        ), parent.id)
        for index, scene in enumerate(chapter_scenes, start=1):
            binder.add(DocumentNode(
                id=scene_id(number, index),
                type=SCENE,
                title=scene["title"],
                synopsis=scene["summary"],
                pov=POV,
            ), node.id)

        outline = [f"# Глава {number}. {row['title']}", "", synopsis.strip(), "", "## Сцены", ""]
        for scene in scenes_by_chapter.get(number, []):
            outline.append(f"### {scene['title']}")
            outline.append((scene.get("description") or "").strip())
            outline.append("")
            outline.append(budget_line(scene["target_char_count"]))
            outline.append("")
        if row.get("beat_title"):
            outline.extend([
                "## Бит",
                "",
                f"{row['beat_title']} ({row.get('beat_act') or ''})",
                "",
                (row.get("beat_description") or "").strip(),
                "",
            ])
        write(dest / "outputs" / f"chapter_{number:03d}_outline.md", "\n".join(outline).strip() + "\n")
        if status == "complete":
            write(dest / "outputs" / "manuscript" / f"chapter_{number:03d}_draft.md", body.strip() + "\n")
            write(dest / "outputs" / "manuscript" / f"chapter_{number:03d}_final.md", body.strip() + "\n")
        elif status == "drafted":
            write(dest / "outputs" / "manuscript" / f"chapter_{number:03d}_draft.md", body.strip() + "\n")

    for title, numbers in touches.items():
        tid = by_name.get(title.strip().lower())
        thread = state.plot_threads.get(tid) if tid else None
        if thread is None or not numbers:
            continue
        thread.start_chapter = min(numbers)
        thread.last_updated_chapter = max(numbers)
        thread.milestones = [
            {"description": f"Глава {n} в плане тома", "chapter": n}
            for n in numbers
        ]

    for i, row in enumerate(relations, start=1):
        source = by_name.get((row["source_name"] or "").strip().lower())
        target = by_name.get((row["target_name"] or "").strip().lower())
        if not source or not target or source == target:
            print(f"skip relation {row['source_name']} -> {row['target_name']}")
            continue
        kind = row["relation_type"] or ""
        note = kind
        if row.get("description"):
            note = f"{kind}. {row['description'].strip()}"
        eid = slug_id("rel", i)
        state.relationships[eid] = RelationshipEdge(
            id=eid,
            source_id=source,
            target_id=target,
            label=BOND.get(kind, "unknown"),
            kind=f"{row['source_kind']}_{row['target_kind']}",
            notes=note,
            directed=kind != "enemy_of",
        )

    state.binder = binder
    state.save_state()

    series = dest / "outputs" / "series.md"
    write(series, "\n\n".join([
        f"# {TITLE}",
        f"Жанр: {GENRE}",
        "## Замысел\n\n" + (project["global_premise"] or "").strip(),
        "## Аннотация\n\n" + (project["annotation"] or "").strip(),
        "## Вопрос серии\n\n" + (project["series_question"] or "").strip(),
        "## Макродуга\n\n" + (project["series_macro_arc"] or "").strip(),
        "## Хребет темы\n\n" + (project["series_theme_spine"] or "").strip(),
        "## Заметки мира\n\n" + (project["world_design_notes"] or "").strip(),
        "## Архитектура серии\n\n" + (project["series_architecture_notes"] or "").strip(),
    ]))
    bible = dest / "outputs" / "story_bible.md"
    write(bible, series.read_text(encoding="utf-8"))

    def patch_block(row: dict) -> str:
        chapter = row.get("chapter_number")
        where = f"глава {chapter}" if chapter else "без главы"
        details = row.get("details")
        detail_text = ""
        if details:
            detail_text = "\n\n" + json.dumps(details, ensure_ascii=False, indent=2)
        quote = (row.get("quote") or "").strip()
        return (
            f"### {row['name']}\n\n"
            f"{row['type']}, {row['status']}, {where}\n\n"
            f"{quote}{detail_text}\n"
        )

    open_rows = [p for p in patches if p["status"] == "open"]
    dismissed = [p for p in patches if p["status"] != "open"]
    queue = ["# Очередь канона", "", "Эти имена и поправки автор ещё не принял. В Кодекс они не заведены.", ""]
    queue.append(f"## Открыто ({len(open_rows)})\n")
    queue.extend(patch_block(row) for row in open_rows)
    queue.append(f"## Отклонено ({len(dismissed)})\n")
    queue.extend(patch_block(row) for row in dismissed)
    write(dest / "outputs" / "canon_queue.md", "\n".join(queue))

    archive = dest / "archive"
    for row in revisions:
        number = int(row["chapter_number"])
        stamp = str(row.get("created_at") or row["id"]).replace(":", "").replace(" ", "T")
        header = (
            f"source: {row.get('source') or ''}\n"
            f"action: {row.get('action') or ''}\n"
            f"created: {row.get('created_at') or ''}\n\n"
        )
        write(
            archive / "revisions" / f"chapter_{number:03d}" / f"{stamp}_{row['id']}.md",
            header + (row.get("body") or ""),
        )
    thread_files = {
        "narrative_agent_thread": "narrative.json",
        "world_design_thread": "world_design.json",
        "series_architecture_thread": "series_architecture.json",
        "last_turn_snapshot": "last_turn_snapshot.json",
    }
    for column, filename in thread_files.items():
        payload = project.get(column)
        if not payload:
            continue
        text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, indent=2)
        write(archive / "agent_threads" / filename, text)

    claim(PROJECT_ID)

    reloaded = StoryState(str(dest))
    metro = reloaded.binder.get(MANUSCRIPT_ID)
    metro_chapters = reloaded.binder.children(metro.id) if metro else []
    scene_nodes = [
        n for n in reloaded.binder.all_nodes() if n.type == SCENE
    ]
    print(json.dumps({
        "project": PROJECT_ID,
        "chapters": len(reloaded.chapters),
        "metro_children": len(metro_chapters),
        "scenes": len(scene_nodes),
        "characters": len(reloaded.characters),
        "codex": len(reloaded.codex),
        "threads": len(reloaded.plot_threads),
        "relations": len(reloaded.relationships),
        "parts": [n.title for n in reloaded.binder.roots()],
        "prose_chapters": prose_chapters,
        "scene_rows": scene_count,
        "revisions": len(revisions),
        "open_flags": len(open_rows),
        "codex_names": sorted(e.name for e in reloaded.codex.values()),
        "character_names": sorted(c.full_name for c in reloaded.characters.values()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
