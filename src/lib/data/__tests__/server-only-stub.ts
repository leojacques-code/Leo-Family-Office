// Remplace le paquet `server-only` sous Vitest. Ce paquet n'existe que pour faire échouer
// le bundle quand un module serveur fuit vers le client : il n'a aucun comportement à
// reproduire, et le neutraliser laisse le repository local testable tel qu'il tourne.
export {};
