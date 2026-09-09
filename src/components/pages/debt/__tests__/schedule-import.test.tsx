import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScheduleImport } from "../schedule-import";
import { SCHEDULE_HEADER } from "@/lib/acquisition/debt-schedule";
it("vérifie et prévisualise sans écrire, puis exige la confirmation", () => {
  const confirm = vi.fn();
  render(<ScheduleImport disabled={false} onConfirm={confirm} />);
  fireEvent.change(screen.getByLabelText("Document de référence"), {
    target: { value: "CIC — ligne décembre" },
  });
  fireEvent.change(screen.getByLabelText("Lignes de l’échéancier"), {
    target: { value: `${SCHEDULE_HEADER}\n2026-12-05;16745;273,70;0;11,02;0;16471,30;284,72` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Vérifier les lignes" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("table")).toBeVisible();
  expect(screen.getByText("284,72")).toBeVisible();
  expect(screen.getByText(/Premier remboursement de capital : 2026-12-05/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Utiliser ces lignes dans le formulaire" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0][0].principal).toBe(273.7);
});
