// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  saveTheme,
  serverThemeSnapshot,
  subscribeTheme,
  themeBootstrapScript,
  themeSnapshot,
} from "../theme";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("préférence de thème du navigateur", () => {
  it("applique le choix avant l'hydratation, sans flash du thème par défaut", () => {
    window.localStorage.setItem("lfo.theme:v1", "dark");
    new Function(themeBootstrapScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(serverThemeSnapshot()).toBe("light");
  });

  it("restaure le choix après rechargement sans changer le snapshot serveur", () => {
    saveTheme("dark");
    delete document.documentElement.dataset.theme;
    expect(serverThemeSnapshot()).toBe("light");
    const notify = vi.fn();
    const stop = subscribeTheme(notify);
    expect(themeSnapshot()).toBe("dark");
    expect(notify).toHaveBeenCalledOnce();
    stop();
  });

  it("notifie le changement local, conserve le choix et retire son écouteur", () => {
    const notify = vi.fn();
    const stop = subscribeTheme(notify);
    notify.mockClear();
    saveTheme("dark");
    expect(themeSnapshot()).toBe("dark");
    expect(window.localStorage.getItem("lfo.theme:v1")).toBe("dark");
    expect(notify).toHaveBeenCalledOnce();
    stop();
    saveTheme("light");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("synchronise un autre onglet sans réécrire sa préférence", () => {
    const stop = subscribeTheme(vi.fn());
    window.localStorage.setItem("lfo.theme:v1", "dark");
    const write = vi.spyOn(Storage.prototype, "setItem");
    window.dispatchEvent(new StorageEvent("storage", { key: "lfo.theme:v1" }));
    expect(themeSnapshot()).toBe("dark");
    expect(write).not.toHaveBeenCalled();
    stop();
  });

  it("ignore une préférence invalide et les événements d'un autre stockage", () => {
    window.localStorage.setItem("lfo.theme:v1", "unknown");
    const notify = vi.fn();
    const stop = subscribeTheme(notify);
    expect(themeSnapshot()).toBe("light");
    notify.mockClear();
    window.dispatchEvent(new StorageEvent("storage", { key: "another-preference" }));
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it("reste utilisable lorsque le navigateur refuse le stockage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const notify = vi.fn();
    const stop = subscribeTheme(notify);
    expect(() => saveTheme("dark")).not.toThrow();
    expect(themeSnapshot()).toBe("dark");
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });
});
