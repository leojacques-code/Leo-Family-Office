/** Révèle la case dans sa surface défilante, sans déplacer la page de revue. */
export function revealScheduleField(id: string, selector: string) {
  const field = document.getElementById(id);
  const pane = field?.closest<HTMLElement>(selector);
  if (!field || !pane || pane.clientHeight === 0 || pane.clientWidth === 0) return;
  const bounds = pane.getBoundingClientRect();
  const cell = field.getBoundingClientRect();
  const headerHeight = pane.querySelector("thead")?.getBoundingClientRect().height ?? 0;
  const top = bounds.top + pane.clientTop + headerHeight + 4;
  const bottom = bounds.top + pane.clientTop + pane.clientHeight - 4;
  const left = bounds.left + pane.clientLeft + 4;
  const right = bounds.left + pane.clientLeft + pane.clientWidth - 4;
  const dy = cell.top < top ? cell.top - top : cell.bottom > bottom ? cell.bottom - bottom : 0;
  const dx = cell.left < left ? cell.left - left : cell.right > right ? cell.right - right : 0;
  if (dx || dy) pane.scrollBy({ top: dy, left: dx, behavior: "auto" });
}
