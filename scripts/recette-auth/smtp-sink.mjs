// Collecteur SMTP de recette : accepte tout message sur 127.0.0.1 et l'écrit dans un fichier.
// Permet de suivre le VRAI lien de confirmation émis par Auth, sans envoyer de mail.
import { createServer } from "node:net";
import { writeFileSync, mkdirSync } from "node:fs";

const dir = `${process.env.RECETTE_DIR}/mails`;
const port = Number(process.env.RECETTE_SMTP_PORT ?? 55025);
mkdirSync(dir, { recursive: true });
createServer((socket) => {
  let data = false;
  let buffer = "";
  const reply = (line) => socket.write(`${line}\r\n`);
  reply("220 lfo-recette ESMTP");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (data) {
      const end = buffer.indexOf("\r\n.\r\n");
      if (end < 0) return;
      writeFileSync(`${dir}/${Date.now()}.eml`, buffer.slice(0, end));
      buffer = buffer.slice(end + 5);
      data = false;
      reply("250 OK");
    }
    let index;
    while (!data && (index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === "EHLO" || verb === "HELO") reply("250 lfo-recette");
      else if (verb === "DATA") {
        data = true;
        reply("354 end with <CRLF>.<CRLF>");
      } else if (verb === "QUIT") {
        reply("221 bye");
        socket.end();
      } else reply("250 OK");
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`smtp-sink 127.0.0.1:${port}`));
