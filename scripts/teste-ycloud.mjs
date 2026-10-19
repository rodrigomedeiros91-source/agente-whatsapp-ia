// YCloud: assinatura, tradução do evento para o formato da Meta, envio e mídia.
// Ver src/services/ycloud.js. Nada aqui sai para a rede: o fetch é falso.
//   node scripts/teste-ycloud.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assinaturaValida, paraMeta, linkDaYCloud, e164 } from "../src/nucleo/ycloud.js";
import {
  parseIncomingMessage,
  sendWhatsAppMessage,
  enviarTemplate,
  markAsReadAndTyping,
} from "../src/nucleo/whatsapp.js";
import { downloadMedia } from "../src/nucleo/media.js";
import { clientesDoEco } from "../src/nucleo/humano.js";
import { conferirAmbiente } from "../src/nucleo/ambiente.js";

const ok = (nome, cond) => {
  assert.ok(cond, nome);
  console.log(`ok   ${nome}`);
};

// --- assinatura -------------------------------------------------------------
const segredo = "whsec_teste";
const corpo = Buffer.from('{"id":"evt_1","type":"whatsapp.inbound_message.received"}');
const agora = Date.parse("2026-10-13T12:00:00Z");
const t = Math.floor(agora / 1000);
const assina = (ts, b = corpo, s = segredo) =>
  `t=${ts},s=${crypto.createHmac("sha256", s).update(`${ts}.`).update(b).digest("hex")}`;

ok("assinatura certa passa", assinaturaValida(corpo, assina(t), segredo, agora));
ok("segredo errado é recusado", !assinaturaValida(corpo, assina(t, corpo, "outro"), segredo, agora));
ok("corpo mexido é recusado", !assinaturaValida(Buffer.from(corpo + " "), assina(t), segredo, agora));
ok("mensagem de 10 minutos atrás é recusada", !assinaturaValida(corpo, assina(t - 600), segredo, agora));
ok("sem cabeçalho é recusado", !assinaturaValida(corpo, undefined, segredo, agora));
ok("sem segredo configurado, recusa tudo", !assinaturaValida(corpo, assina(t), "", agora));
ok("cabeçalho torto não quebra", !assinaturaValida(corpo, "lixo", segredo, agora));

// --- entrada: evento da YCloud vira webhook da Meta ------------------------
const recebida = (msg) => ({
  id: "evt_x",
  type: "whatsapp.inbound_message.received",
  whatsappInboundMessage: {
    id: "63f8",
    wamid: "wamid.IN",
    wabaId: "WABA",
    from: "+5511900000002",
    to: "+5511900000003",
    customerProfile: { name: "Joe" },
    ...msg,
  },
});

const texto = parseIncomingMessage(paraMeta(recebida({ type: "text", text: { body: "tem horário amanhã?" } })));
ok("texto chega com o telefone só em dígitos", texto.from === "5511900000002");
ok("o id é o wamid", texto.id === "wamid.IN");
ok("o texto e o nome chegam", texto.text === "tem horário amanhã?" && texto.contactName === "Joe");

const botao = parseIncomingMessage(
  paraMeta(recebida({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "opt_0", title: "Tarde" } } }))
);
ok("toque em botão vira texto", botao.kind === "text" && botao.text === "Tarde");

const link = "https://api.ycloud.com/v2/whatsapp/media/download/712?sig=abc";
const audio = parseIncomingMessage(paraMeta(recebida({ type: "audio", audio: { id: "712", link, mime_type: "audio/ogg" } })));
ok("áudio traz o link para baixar", audio.kind === "audio" && audio.mediaLink === link);

ok("status de entrega é ignorado", paraMeta({ type: "whatsapp.message.updated", whatsappMessage: {} }) === null);
ok("cliente sem telefone é ignorado", paraMeta(recebida({ from: undefined, type: "text", text: { body: "oi" } })) === null);
ok("evento vazio não quebra", paraMeta(undefined) === null && paraMeta({}) === null);

const eco = paraMeta({
  type: "whatsapp.smb.message.echoes",
  whatsappMessage: { wamid: "wamid.ECO", from: "+5511900000003", to: "+5511900000002", type: "text", text: { body: "fala!" } },
});
ok("O dono respondeu pelo app: o eco aponta o cliente", clientesDoEco(eco)[0] === "5511900000002");
ok("e não vira mensagem para o agente responder", parseIncomingMessage(eco) === null);

// --- saída: fetch falso -----------------------------------------------------
const chamadas = [];
let resposta = {};
globalThis.fetch = async (url, opcoes = {}) => {
  chamadas.push({ url: String(url), opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
  return new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } });
};
const ultima = () => chamadas.at(-1);

process.env.WHATSAPP_PROVEDOR = "ycloud";
process.env.YCLOUD_API_KEY = "chave-falsa";
process.env.YCLOUD_NUMERO = "5511900000003";

resposta = { id: "out1", wamid: "wamid.OUT" };
await sendWhatsAppMessage("5511900000002", "Amanhã às 15h com o Bruno. Fechado?");
ok("envia pelo sendDirectly da YCloud", ultima().url === "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly");
ok("com a chave da YCloud", ultima().opcoes.headers["X-API-Key"] === "chave-falsa");
ok("de e para em E.164", ultima().corpo.from === "+5511900000003" && ultima().corpo.to === "+5511900000002");
ok("sem o campo que é só da Meta", !("messaging_product" in ultima().corpo));
ok("o texto vai no formato de sempre", ultima().corpo.type === "text" && ultima().corpo.text.body.includes("Fechado?"));

const joinha = parseIncomingMessage(
  paraMeta(recebida({ type: "reaction", reaction: { message_id: "wamid.OUT", emoji: "👍" } }))
);
ok("joinha na pergunta que o agente mandou vira sim (o wamid foi guardado)", joinha?.text === "sim");

resposta = { wamid: "wamid.TPL" };
const tpl = await enviarTemplate("5511900000002", { nome: "lembrete_vespera", variaveis: ["Joe", "Studio Exemplo"] });
ok("lembrete (modelo) sai pela YCloud", tpl.ok && tpl.id === "wamid.TPL" && ultima().corpo.template.name === "lembrete_vespera");

await markAsReadAndTyping("wamid.IN");
ok("'digitando…' usa a rota da YCloud", ultima().url === "https://api.ycloud.com/v2/whatsapp/inboundMessages/wamid.IN/typing");

const antes = chamadas.length;
const golpe = await downloadMedia("712", "https://exemplo.com/roubar-chave");
ok("a chave nunca vai para link de fora da YCloud", golpe.error && chamadas.length === antes);
ok("link da YCloud é reconhecido", linkDaYCloud(link) && !linkDaYCloud("https://api.ycloud.com.exemplo.com/x"));
await downloadMedia("712", link);
ok("mídia baixa do link com a chave", ultima().url === link && ultima().opcoes.headers["X-API-Key"] === "chave-falsa");

delete process.env.WHATSAPP_PROVEDOR;
resposta = { messages: [{ id: "wamid.META" }] };
await sendWhatsAppMessage("5511900000002", "oi");
ok("sem a variável, continua indo direto para a Meta", ultima().url.startsWith("https://graph.facebook.com/"));
ok("e no formato da Meta", ultima().corpo.messaging_product === "whatsapp");
ok("e164 só põe o + nos dígitos", e164("(11) 90000-0003") === "+11900000003" && e164("") === "");

// --- ambiente ---------------------------------------------------------------
const nomesYCloud = ["YCLOUD_API_KEY", "YCLOUD_NUMERO", "YCLOUD_WEBHOOK_SECRET"];
process.env.WHATSAPP_PROVEDOR = "ycloud";
for (const n of nomesYCloud) delete process.env[n];
let { erros } = conferirAmbiente();
ok("com YCloud, exige as três variáveis dela", nomesYCloud.every((n) => erros.some((e) => e.startsWith(n))));
ok("e não exige mais o token da Meta", !erros.some((e) => e.startsWith("WHATSAPP_TOKEN")));
process.env.WHATSAPP_PROVEDOR = "ycluod";
({ erros } = conferirAmbiente());
ok("provedor escrito errado não sobe", erros.some((e) => e.includes("WHATSAPP_PROVEDOR")));
delete process.env.WHATSAPP_PROVEDOR;

console.log("\ntodos os casos passaram");
