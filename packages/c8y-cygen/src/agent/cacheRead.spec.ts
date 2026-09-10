/**
 * The standing cache check.
 *
 * A caching regression is silent and expensive: the requests keep succeeding and only the bill
 * changes. So a second identical request must report a non-zero cache-read count, and that has
 * to be asserted somewhere rather than assumed.
 *
 * It costs two real API calls, so it does not run in the ordinary suite. Set
 * C8Y_CYGEN_LIVE_CACHE_CHECK=1 to run it - in CI on a schedule, or by hand after touching
 * prompt assembly. No tenant is needed; only an API key.
 */
import { AnthropicModel } from "./anthropicModel.js";
import { assemblePrompt } from "./promptAssembly.js";
import { b0Contract, b0Conventions } from "../testing/b0.js";

const live = process.env["C8Y_CYGEN_LIVE_CACHE_CHECK"] === "1";
const describeLive = live ? describe : describe.skip;

describeLive("prompt caching, against the real endpoint", () => {
  const prompt = () =>
    assemblePrompt({
      contract: b0Contract(),
      conventions: b0Conventions(),
      houseRules: "# House rules\n\nPrefer data-cy.\n",
      ir: null,
      facts: null,
      lint: null,
      attempts: [],
      progressLine: "run 0 of 6 (probe 0 of 3, model turn 0 of 12), 0 of 7 covered",
      effectiveStyle: "integration",
    });

  it("reads the prefix back on a second identical request", async () => {
    const model = new AnthropicModel();

    const first = await model.authorIr({ prompt: prompt() });
    const second = await model.authorIr({ prompt: prompt() });

    // The first request writes; the second must read. If this is zero, a silent invalidator is
    // at work upstream - a timestamp in the prefix, a rebuilt schema, a re-read that normalised
    // the house-rules bytes.
    expect(first.usage.cacheCreationInputTokens).toBeGreaterThan(0);
    expect(second.usage.cacheReadInputTokens).toBeGreaterThan(0);
  }, 300_000);

  it("counts tokens against the real assembled prompt", async () => {
    // The free measurement. The four-bytes-per-token conversion behind every payload figure in
    // the design is likely about 30% low, and this settles it at no cost.
    const counted = await new AnthropicModel().countTokens({ prompt: prompt() });

    expect(counted).toBeGreaterThan(0);
  }, 120_000);
});

describe("the cache check itself", () => {
  it("is skipped unless it is asked for, because it spends real money", () => {
    expect(live).toBe(process.env["C8Y_CYGEN_LIVE_CACHE_CHECK"] === "1");
  });
});
