import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../components/RichTextEditor", () => ({
  default: () => <div aria-label="Чистовая рукопись" />,
}));

vi.mock("../components/ContinueChat", () => ({
  default: () => null,
}));

import FinalEditor from "../components/FinalEditor";
import { getReaderFont } from "../theme";
import { EMPTY_DOC } from "../lib/richText";

function renderEditor() {
  render(
    <FinalEditor
      projectId="book"
      chapterNumber={1}
      hasFinal
      canPromote={false}
      promoteFrom=""
      doc={EMPTY_DOC}
      wordCount={4}
      onChange={() => {}}
      onSave={() => {}}
      onPromote={() => {}}
      dirty={false}
      busy={null}
      lastSaved={null}
      focus={false}
      onToggleFocus={() => {}}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.readerFont;
});

test("defaults the manuscript canvas to SF Pro", () => {
  renderEditor();
  expect(getReaderFont()).toBe("sans");
  const group = screen.getByRole("radiogroup", { name: "Шрифт чтения" });
  expect(group.querySelector('[aria-checked="true"]')).toHaveAttribute("aria-label", "SF Pro");
});

test("switching the reader font rebinds the token and persists it", async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("radio", { name: "Newsreader" }));

  expect(document.documentElement.dataset.readerFont).toBe("serif");
  expect(getReaderFont()).toBe("serif");
});

test("counts words and characters from the manuscript", () => {
  render(
    <FinalEditor
      projectId="book"
      chapterNumber={1}
      hasFinal
      canPromote={false}
      promoteFrom=""
      doc={{
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Раз два" }] }],
      }}
      wordCount={0}
      onChange={() => {}}
      onSave={() => {}}
      onPromote={() => {}}
      dirty={false}
      busy={null}
      lastSaved={null}
      focus={false}
      onToggleFocus={() => {}}
    />,
  );
  expect(screen.getByText("2 слова · 7 символов")).toBeInTheDocument();
});

test("offers all three reader fonts as visible choices", () => {
  renderEditor();
  const group = screen.getByRole("radiogroup", { name: "Шрифт чтения" });
  const labels = [...group.querySelectorAll('[role="radio"]')].map((el) =>
    el.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["SF Pro", "Newsreader", "Mono"]);
});
