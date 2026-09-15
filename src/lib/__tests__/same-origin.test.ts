import { describe, expect, it } from "vitest";
import { isSameOrigin } from "../same-origin";
describe("Origine navigateur derrière le serveur Next", () => {
  it("accepte le Host public quand l'URL serveur utilise localhost", () =>
    expect(
      isSameOrigin(
        new Request("http://localhost:3109/api/auth", {
          headers: { host: "127.0.0.1:3109", origin: "http://127.0.0.1:3109" },
        }),
      ),
    ).toBe(true));
  it("accepte HTTPS derrière un reverse proxy", () =>
    expect(
      isSameOrigin(
        new Request("http://internal/api/auth", {
          headers: {
            host: "lfo.example",
            "x-forwarded-proto": "https",
            origin: "https://lfo.example",
          },
        }),
      ),
    ).toBe(true));
  it.each([
    "https://foreign.invalid",
    "null",
    "https://lfo.example.evil.invalid",
    "http://lfo.example",
  ])("refuse l'origine %s", (origin) =>
    expect(
      isSameOrigin(
        new Request("https://lfo.example/api/auth", { headers: { host: "lfo.example", origin } }),
      ),
    ).toBe(false),
  );
});
