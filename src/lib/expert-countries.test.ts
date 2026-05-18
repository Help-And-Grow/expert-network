import { describe, expect, it } from "vitest";

import {
  detectCountriesInQuery,
  detectStandaloneCountriesInQuery,
} from "@/lib/expert-countries";

describe("expert country detection", () => {
  it("detects standalone country inputs used as follow-up searches", () => {
    expect(detectStandaloneCountriesInQuery("Taiwan")).toEqual(["TW"]);
    expect(detectStandaloneCountriesInQuery("Japan")).toEqual(["JP"]);
    expect(detectStandaloneCountriesInQuery("New Zealand")).toEqual(["NZ"]);
    expect(detectStandaloneCountriesInQuery(" Japan? ")).toEqual(["JP"]);
  });

  it("does not treat broader topic searches as standalone country inputs", () => {
    expect(detectStandaloneCountriesInQuery("BD expert in Japan")).toEqual([]);
    expect(detectStandaloneCountriesInQuery("AI startups in Singapore")).toEqual([]);
  });

  it("does not recall India from the English preposition in", () => {
    expect(detectCountriesInQuery("Expert in Vietnam")).toEqual(["VN"]);
    expect(detectCountriesInQuery("BD expert for AI startups in Japan")).toEqual(["JP"]);
    expect(detectCountriesInQuery("BD expert for AI startups in Singapore")).toEqual(["SG"]);
  });
});
