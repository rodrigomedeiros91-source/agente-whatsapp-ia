// Coexistência: quem o agente atende e quando se cala. Ver src/services/humano.js.
//   node scripts/teste-humano.mjs
import assert from "node:assert/strict";
import { clientesDoEco, pausar, pausado, liberado, __esquecerPausas } from "../src/nucleo/humano.js";

const ok = (nome, cond) => {
  assert.ok(cond, nome);
  console.log(`ok   ${nome}`);
};

// Formato do webhook da Meta para mensagem mandada pelo app (smb_message_echoes).
const eco = {
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "smb_message_echoes", value: {
    messaging_product: "whatsapp",
    message_echoes: [{ from: "5511900000003", to: "5511900000002", id: "wamid.X", type: "text", text: { body: "fala!" } }],
  } }] }],
};
const mensagem = { entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "5511900000002" }] } }] }] };

ok("eco do app aponta o cliente", clientesDoEco(eco)[0] === "5511900000002");
ok("mensagem comum de cliente não é eco", clientesDoEco(mensagem).length === 0);
ok("webhook vazio não quebra", clientesDoEco({}).length === 0);

__esquecerPausas();
process.env.PAUSA_HUMANO_MIN = "240";
const t0 = Date.parse("2026-10-08T12:00:00Z");
pausar("5511900000002", t0);
ok("depois que o dono responde, o agente se cala", pausado("5511900000002", t0 + 60 * 60 * 1000));
ok("só naquela conversa", !pausado("5511900000001", t0));
ok("e volta a responder depois da pausa", !pausado("5511900000002", t0 + 241 * 60 * 1000));

delete process.env.ATENDER_SOMENTE;
ok("sem lista, atende todo mundo", liberado("5511999999999"));
process.env.ATENDER_SOMENTE = "11900000001, 5511900000002";
ok("com lista, atende quem está nela (com ou sem 55)", liberado("5511900000001") && liberado("5511900000002"));
ok("e ignora quem não está", !liberado("5511999999999"));
ok("o dono passa sempre, para responder o Sim/Não", liberado("5521911112222", "5521911112222"));
ok("dono vazio não libera ninguém por engano", !liberado("5511999999999", ""));
delete process.env.ATENDER_SOMENTE;

console.log("\ntodos os casos passaram");
