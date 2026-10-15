import { describe, expect, it } from "vitest";
import { locateQuote, type TextChar } from "./findQuote";

function chars(text: string, origin = 1): TextChar[] {
  return [...text].map((ch, i) => ({ ch, pos: origin + i }));
}

describe("locateQuote", () => {
  it("finds an exact stretch and returns document positions", () => {
    const found = locateQuote(chars("Он стоял у двери и смотрел."), "стоял у двери");
    expect(found).toEqual({ from: 4, to: 17 });
  });

  it("matches across a line break", () => {
    const found = locateQuote(chars("Он стоял у двери\nи смотрел на лестницу"), "у двери и смотрел");
    expect(found?.from).toBe(10);
    expect(found && found.to > found.from).toBe(true);
  });

  it("refuses a quote that is not in the text", () => {
    expect(locateQuote(chars("Он стоял у двери."), "этого куска нет")).toBeNull();
  });
});
