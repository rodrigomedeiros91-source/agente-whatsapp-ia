// Conversa com o agente de exemplo no terminal, sem WhatsApp. Precisa só de
// ANTHROPIC_API_KEY no .env.
//
//   npm run demo                                  conversa livre (Ctrl+C sai)
//   npm run demo -- "oi" "quero cortar amanhã"    roteiro: uma mensagem por argumento
//
// A resposta passa pela mesma peneira de tom e pelo mesmo humanize() que o
// servidor usa antes de enviar, e os botões aparecem como [ Botão ].
import "dotenv/config";
import readline from "node:readline/promises";
import { getAgentReply } from "../src/nucleo/claude.js";
import { extrairOpcoes, humanize } from "../src/nucleo/whatsapp.js";
import { peneirarTom } from "../src/nucleo/tom.js";
import * as negocio from "../src/exemplo/index.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY no .env (copie o .env.example).");
  process.exit(1);
}

const TELEFONE = "5511900000001";
let historico = [];

async function falar(texto) {
  console.log(`\nCliente: ${texto}`);
  const { reply, updatedHistory } = await getAgentReply([...historico, { role: "user", content: texto }], TELEFONE, {
    contactName: "Cliente Demo",
    negocio,
  });
  historico = updatedHistory;
  const { texto: corpo, opcoes } = extrairOpcoes(peneirarTom(reply));
  console.log(`${negocio.rotulo()}: ${humanize(corpo)}`);
  if (opcoes.length) console.log("  " + opcoes.map((o) => `[ ${o} ]`).join(" "));
}

const roteiro = process.argv.slice(2);
if (roteiro.length) {
  for (const msg of roteiro) await falar(msg);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Conversando com o agente do ${negocio.rotulo()}. Ctrl+C para sair.`);
  for (;;) await falar(await rl.question("\n> "));
}
