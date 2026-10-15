"use client";

import { memo, type KeyboardEvent } from "react";

import type { ScheduleFieldView } from "@/lib/data/schedule-document-contracts";
import type { ScheduleGrid } from "@/lib/presentation/debt/schedule-review";
import { FIELD_STATUS_LABELS } from "./client";

/** Marque textuelle de l'état d'une cellule : la couleur seule ne porte jamais l'information. */
const MARKS: Partial<Record<ScheduleFieldView["validationStatus"], string>> = {
  BLOCKED: "!",
  CORRECTED: "✎",
  REJECTED: "×",
  REVIEWED: "✓",
};

/**
 * La PIÈCE telle que lue : toutes les colonnes du fichier, reconnues ou non, avec ses numéros
 * de ligne et ses lettres de colonne. Rien n'y est recalculé ni reformaté : la cellule montre
 * ce que le fichier portait.
 */
const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * La PIÈCE telle que lue : toutes les colonnes du fichier, reconnues ou non, avec ses numéros
 * de ligne et ses lettres de colonne. Rien n'y est recalculé ni reformaté : la cellule montre
 * ce que le fichier portait.
 *
 * Au clavier, la grille est UN arrêt de tabulation (la cellule sélectionnée, ou la première) ;
 * les flèches, Origine et Fin s'y déplacent et sélectionnent. Un arrêt par cellule imposerait
 * des milliers de tabulations avant la case sélectionnée.
 */
export const SourceGrid = memo(function SourceGrid({
  grid,
  selectedId,
  onSelect,
}: {
  grid: ScheduleGrid;
  selectedId: string | null;
  onSelect: (fieldId: string) => void;
}) {
  const firstId = grid.rows[0]?.cells[grid.columns[0]?.key ?? ""]?.fieldId ?? null;
  const tabStop = selectedId ?? firstId;

  function move(event: KeyboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    let next: [number, number] | null = null;
    if (event.key in MOVES) {
      const [dr, dc] = MOVES[event.key]!;
      next = [row + dr, col + dc];
    } else if (event.key === "Home") next = [event.ctrlKey ? 0 : row, 0];
    else if (event.key === "End")
      next = [event.ctrlKey ? grid.rows.length - 1 : row, grid.columns.length - 1];
    if (!next) return;
    event.preventDefault();
    const [r, c] = next;
    const field = grid.rows[r]?.cells[grid.columns[c]?.key ?? ""];
    if (!field) return;
    onSelect(field.fieldId);
    document.getElementById(`schedule-cell-${field.fieldId}`)?.focus();
  }

  return (
    <div className="schedule-grid-scroll" tabIndex={0} aria-label="Pièce telle que lue">
      <table className="schedule-grid" onKeyDown={move}>
        <caption className="visually-hidden">
          {grid.sheetName ? `Feuille « ${grid.sheetName} »` : "Fichier"} : cellules lues, une ligne
          par échéance ; les flèches déplacent la sélection
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Ligne du fichier</span>
            </th>
            {grid.columns.map((column) => (
              <th key={column.key} scope="col" data-recognized={column.recognized}>
                <span className="schedule-grid-letter">{column.letter}</span>
                <span className="schedule-grid-label">{column.label ?? "sans en-tête"}</span>
                {column.recognized ? null : <small>non reconnue</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, rowIndex) => (
            <tr key={row.rowNumber}>
              <th scope="row">{row.rowNumber}</th>
              {grid.columns.map((column, colIndex) => {
                const field = row.cells[column.key];
                if (!field) return <td key={column.key} />;
                const selected = field.fieldId === selectedId;
                const status = FIELD_STATUS_LABELS[field.validationStatus];
                return (
                  <td key={column.key} data-status={field.validationStatus.toLowerCase()}>
                    <button
                      aria-label={`${field.cellRef ?? ""} ${field.rawValue ?? "vide"}, ${status}`}
                      aria-pressed={selected}
                      data-col={colIndex}
                      data-row={rowIndex}
                      id={`schedule-cell-${field.fieldId}`}
                      tabIndex={field.fieldId === tabStop ? 0 : -1}
                      onClick={() => onSelect(field.fieldId)}
                      type="button"
                    >
                      {field.rawValue ?? ""}
                      {MARKS[field.validationStatus] ? (
                        <span aria-hidden="true" className="schedule-mark">
                          {MARKS[field.validationStatus]}
                        </span>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
