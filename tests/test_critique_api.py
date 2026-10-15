"""Chapter critic: one criterion per request, model swapped for a stub."""

import json

from fastapi.testclient import TestClient

from api.main import create_app
from api.services import parse_critique_payload, quote_in_prose


def _client(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    app = create_app(projects_root=projects, db_url=f"sqlite:///{tmp_path / 't.db'}")
    return TestClient(app)


def test_parse_critique_ignores_state_block_and_think_tag():
    raw = """<think>черновик {"verdict": "нет"}</think>
{"verdict": "Связи держатся.", "items": [],}
[SCRIBE_STATE_UPDATE]
Key_Events:
  - {не брать}
[/SCRIBE_STATE_UPDATE]
"""
    verdict, items = parse_critique_payload(raw)
    assert verdict == "Связи держатся."
    assert items == []


def test_parse_critique_strips_fence_and_drops_short_quotes():
    raw = """```json
{"verdict": "Есть повтор.", "items": [{"quote": "он кивнул", "note": "x", "instruction": "y"}]}
```"""
    verdict, items = parse_critique_payload(raw)
    assert verdict == "Есть повтор."
    assert items[0]["quote"] == "он кивнул"
    prose = "Сначала он кивнул. Потом он кивнул снова и вышел."
    assert quote_in_prose("он кивнул снова и вышел", prose)
    assert not quote_in_prose("он кивнул", prose)


class _PaceLLM:
    def __init__(self):
        self.prompts: list[str] = []

    def complete(self, system, prompt):
        self.prompts.append(f"{system}\n{prompt}")
        return json.dumps({
            "verdict": "Середина долго стоит на месте.",
            "items": [
                {
                    "quote": "Он стоял у двери и смотрел на лестницу",
                    "note": "На три абзаца положение не меняется.",
                    "instruction": "Сократи стояние у двери до одной фразы.",
                },
                {
                    "quote": "этого куска в главе нет",
                    "note": "выдумка",
                    "instruction": "не брать",
                },
            ],
        })


class _FakeOrch:
    llm = _PaceLLM()

    def _get_llm(self):
        return self.llm


def test_critique_one_criterion(tmp_path, monkeypatch):
    client = _client(tmp_path)
    created = client.post("/api/projects", json={
        "title": "Harbor", "genre": "Mystery", "author": "Ada",
    }).json()
    pid = created["id"]
    from state_manager import ChapterState, StoryState

    root = tmp_path / "projects" / pid
    s = StoryState(str(root))
    s.chapters[1] = ChapterState(number=1, title="One", status="drafted")
    s.save_state()
    manuscript = root / "outputs" / "manuscript"
    manuscript.mkdir(parents=True, exist_ok=True)
    manuscript.joinpath("chapter_001_final.md").write_text(
        "Он стоял у двери и смотрел на лестницу. Никто не шёл.\n"
        "Он стоял у двери и смотрел на лестницу ещё минуту.",
        encoding="utf-8",
    )

    orch = _FakeOrch()
    monkeypatch.setattr("api.services.build_orchestrator", lambda _dir: orch)

    bad = client.post(f"/api/projects/{pid}/chapters/1/critique?criterion=score")
    assert bad.status_code == 400

    res = client.post(f"/api/projects/{pid}/chapters/1/critique?criterion=pace")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["criterion"] == "pace"
    assert body["verdict"].startswith("Середина")
    assert len(body["items"]) == 1
    assert "лестницу" in body["items"][0]["quote"]
    assert "JSON" in orch.llm.prompts[0]
    assert "Темп" in orch.llm.prompts[0]


class _ProseThenJson:
    def __init__(self):
        self.calls = 0

    def complete(self, _system, _prompt):
        self.calls += 1
        if self.calls == 1:
            return "Причинность в порядке, но вот разбор прозой, без объекта."
        return json.dumps({"verdict": "Связи держатся.", "items": []})


def test_critique_retries_when_the_first_reply_is_prose(tmp_path, monkeypatch):
    client = _client(tmp_path)
    pid = client.post("/api/projects", json={"title": "Harbor"}).json()["id"]
    from state_manager import ChapterState, StoryState

    root = tmp_path / "projects" / pid
    s = StoryState(str(root))
    s.chapters[1] = ChapterState(number=1, title="One", status="drafted")
    s.save_state()
    manuscript = root / "outputs" / "manuscript"
    manuscript.mkdir(parents=True, exist_ok=True)
    manuscript.joinpath("chapter_001_final.md").write_text(
        "Он стоял у двери и смотрел на лестницу.",
        encoding="utf-8",
    )
    llm = _ProseThenJson()

    class _Orch:
        def _get_llm(self):
            return llm

    monkeypatch.setattr("api.services.build_orchestrator", lambda _dir: _Orch())
    res = client.post(f"/api/projects/{pid}/chapters/1/critique?criterion=causality")
    assert res.status_code == 200, res.text
    assert res.json()["verdict"] == "Связи держатся."
    assert llm.calls == 2


class _AutonomyLLM:
    def __init__(self):
        self.prompts: list[str] = []

    def complete(self, _system, prompt):
        self.prompts.append(prompt)
        if "REWRITE SPAN" in prompt:
            return (
                "[REWRITTEN]\nОн шагнул к лестнице.\n[/REWRITTEN]\n"
                "[SCRIBE_STATE_UPDATE]\nKey_Events: None\n[/SCRIBE_STATE_UPDATE]\n"
            )
        critiques = [p for p in self.prompts if "Критерий:" in p]
        if len(critiques) == 1:
            return json.dumps({
                "verdict": "Середина стоит.",
                "items": [{
                    "quote": "Он стоял у двери и смотрел на лестницу",
                    "note": "Долго стоит.",
                    "instruction": "Пусть шагнёт.",
                }],
            })
        return json.dumps({"verdict": "Темп ровный.", "items": []})


def test_autonomous_pass_uses_cheap_model_once(tmp_path, monkeypatch):
    client = _client(tmp_path)
    pid = client.post("/api/projects", json={"title": "Harbor"}).json()["id"]
    from state_manager import ChapterState, StoryState

    root = tmp_path / "projects" / pid
    s = StoryState(str(root))
    s.chapters[1] = ChapterState(number=1, title="One", status="final")
    s.save_state()
    manuscript = root / "outputs" / "manuscript"
    manuscript.mkdir(parents=True, exist_ok=True)
    final = manuscript / "chapter_001_final.md"
    final.write_text(
        "Он стоял у двери и смотрел на лестницу. Никто не шёл.",
        encoding="utf-8",
    )
    llm = _AutonomyLLM()

    def studio(_dir):
        raise AssertionError("studio model must stay unused")

    monkeypatch.setattr("api.services.build_orchestrator", studio)
    monkeypatch.setattr("api.services.autonomy_client", lambda: llm)

    denied = client.post(f"/api/projects/{pid}/chapters/1/critique/autonomous?criterion=causality")
    assert denied.status_code == 400

    res = client.post(f"/api/projects/{pid}/chapters/1/critique/autonomous?criterion=pace")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["criterion"] == "pace"
    assert body["items"] == []
    assert body["verdict"] == "Темп ровный."
    text = final.read_text(encoding="utf-8")
    assert "Он шагнул к лестнице." in text
    assert "стоял у двери" not in text
    assert sum(1 for p in llm.prompts if "REWRITE SPAN" in p) == 1
    assert sum(1 for p in llm.prompts if "Критерий:" in p) == 2


def test_autonomous_requires_clean_copy(tmp_path, monkeypatch):
    client = _client(tmp_path)
    pid = client.post("/api/projects", json={"title": "Harbor"}).json()["id"]
    from state_manager import ChapterState, StoryState

    root = tmp_path / "projects" / pid
    s = StoryState(str(root))
    s.chapters[1] = ChapterState(number=1, title="One", status="drafted")
    s.save_state()
    manuscript = root / "outputs" / "manuscript"
    manuscript.mkdir(parents=True, exist_ok=True)
    manuscript.joinpath("chapter_001_draft.md").write_text(
        "Он стоял у двери и смотрел на лестницу.",
        encoding="utf-8",
    )
    monkeypatch.setattr("api.services.autonomy_client", lambda: _AutonomyLLM())
    res = client.post(f"/api/projects/{pid}/chapters/1/critique/autonomous?criterion=repetition")
    assert res.status_code == 400


def test_critique_empty_chapter(tmp_path, monkeypatch):
    client = _client(tmp_path)
    pid = client.post("/api/projects", json={"title": "Harbor"}).json()["id"]
    from state_manager import ChapterState, StoryState

    root = tmp_path / "projects" / pid
    s = StoryState(str(root))
    s.chapters[2] = ChapterState(number=2, title="Two", status="planned")
    s.save_state()
    monkeypatch.setattr("api.services.build_orchestrator", lambda _dir: _FakeOrch())
    res = client.post(f"/api/projects/{pid}/chapters/2/critique?criterion=causality")
    assert res.status_code == 400
