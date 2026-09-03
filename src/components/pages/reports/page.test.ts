import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";
import { buildInstitutionalReport } from "@/lib/reporting/report-builder";
import ReportsPage from "./page";

it("transmet le fingerprint exact de l'aperçu dans le lien PDF", () => {
  const state = eventEngineCrossDomainFixture();
  const expected = buildInstitutionalReport(state, { type: "CURRENT_SNAPSHOT" }).manifest
    .financialFingerprint;
  const html = renderToStaticMarkup(
    createElement(ReportsPage, {
      section: "reports",
      state,
      busy: false,
      projection: null,
      mutate: async () => true,
      setExplanation: () => {},
      runProjection: async () => null,
      refresh: async () => {},
    }),
  );
  const href = /href="([^\"]*\/api\/reports\/pdf[^\"]*)"/.exec(html)![1].replaceAll("&amp;", "&");
  const query = new URL(href, "http://localhost").searchParams;
  expect(query.get("expectedFingerprint")).toBe(expected);
  expect(html).toContain(expected);
});
