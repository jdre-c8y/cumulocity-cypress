import { readPackageAsset } from "./assets.js";

describe("readPackageAsset", () => {
  it("reads a file that ships beside the source", () => {
    expect(readPackageAsset("ir/ir.schema.json")).toContain("c8y-cygen/ir.schema.json");
  });
});
