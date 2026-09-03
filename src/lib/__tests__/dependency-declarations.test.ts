import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * UN PAQUET, UNE VERSION
 *
 * Ce contrôle existe parce qu'un défaut réel l'a coûté. Cinq verticales développées en
 * parallèle ont fusionné leurs `package.json` : `pdfjs-dist` s'est retrouvé déclaré DEUX FOIS,
 * en `dependencies` à la version qu'une verticale avait lue, et en `devDependencies` à celle
 * que `main` portait déjà. Un seul arbre est installé, donc une seule des deux versions
 * gagne — et ce n'était pas celle contre laquelle le code compilait.
 *
 * Le gate local ne l'a PAS vu : il construisait sur un `node_modules` déjà en place, qui
 * portait encore l'ancienne version. La préview a échoué au premier `npm ci`, sur une erreur
 * de typage dans une API retirée par la version majeure suivante.
 *
 * C'est la même dérive que celle des noms de contraintes, à un autre étage : chaque branche a
 * choisi contre une base où les autres n'existaient pas. Un contrôle est moins cher qu'un
 * déploiement rouge.
 */

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function manifest(): PackageManifest {
  return JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
}

describe("déclarations de dépendances", () => {
  it("ne déclare aucun paquet à la fois en dependencies et en devDependencies", () => {
    const { dependencies = {}, devDependencies = {} } = manifest();
    const duplicated = Object.keys(dependencies)
      .filter((name) => name in devDependencies)
      .map((name) => `${name} (${dependencies[name]} / ${devDependencies[name]})`);
    expect(
      duplicated,
      "Un paquet déclaré deux fois n'installe qu'une version, et ce n'est pas forcément celle " +
        "contre laquelle le code a été écrit. Une seule déclaration : au runtime si le code " +
        "l'importe à l'exécution, en développement sinon",
    ).toEqual([]);
  });

  it("épingle une version exacte, hors exceptions NOMMÉES", () => {
    // Une plage laisse l'installation choisir : deux déploiements du même commit peuvent alors
    // ne pas porter le même code.
    //
    // Le dépôt épingle tout SAUF `prettier`, et cette exception est constatée, pas décrétée :
    // la lister ici dit la vérité de l'état actuel là où affirmer « tout est épinglé » serait
    // faux. Ce qu'elle protège, c'est la SUITE — une plage ajoutée demain échoue ici.
    const KNOWN_RANGED = ["prettier"];
    const { dependencies = {}, devDependencies = {}, optionalDependencies = {} } = manifest();
    const ranged = Object.entries({ ...dependencies, ...devDependencies, ...optionalDependencies })
      .filter(([name]) => !KNOWN_RANGED.includes(name))
      .filter(([, version]) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
      .map(([name, version]) => `${name}@${version}`);
    expect(ranged).toEqual([]);
  });

  it("déclare en dependencies ce que le code importe à l'exécution", () => {
    // `pdfjs-dist` est importé dynamiquement par le lecteur de liasse, qui tourne côté
    // serveur : le classer en développement le ferait disparaître d'un déploiement.
    const { dependencies = {} } = manifest();
    expect(dependencies["pdfjs-dist"]).toBeDefined();
  });
});
