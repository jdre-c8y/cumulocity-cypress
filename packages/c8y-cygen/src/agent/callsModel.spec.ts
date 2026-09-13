import { parseIrReply } from "./callsModel.js";

describe("a reply the model never finished writing", () => {
  it("names truncation rather than blaming the fence", () => {
    // What B1's first live run did three iterations running: outputTokens exactly at the cap,
    // the IR cut off mid-document, the closing fence never written. "No fenced code block" is
    // true and useless - it tells the model its formatting was wrong, so it writes the same
    // over-long reply again. The cap is in the stop reason, which was returned all along.
    expect(() => parseIrReply('```json\n{"version": 1, "steps": [', "max_tokens")).toThrow(
      /ran out of output/
    );
  });

  it("still blames the fence when the reply really carried none", () => {
    expect(() => parseIrReply("I think you should reconsider.", "end_turn")).toThrow(
      /no fenced code block/
    );
  });

  it("does not cry truncation over a reply that parsed", () => {
    expect(parseIrReply('```json\n{"version": 1}\n```', "max_tokens")).toEqual({ version: 1 });
  });
});
