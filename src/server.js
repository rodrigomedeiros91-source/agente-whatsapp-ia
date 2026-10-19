import "dotenv/config";
import express from "express";
import { travarFuso, exigirAmbienteValido, hospedado } from "./nucleo/ambiente.js";
import {
  sendWhatsAppMessage,
  parseIncomingMessage,
  markAsReadAndTyping,
  unsupportedReplyFor,
} from "./nucleo/whatsapp.js";
import { getAgentReply } from "./nucleo/claude.js";
import { getHistory, saveHistory, alreadyProcessed } from "./nucleo/sessionStore.js";
import {
  ATIVA as ESTADO_EM_DISCO,
  porqueDesligada,
  instalarGravacaoNoDesligamento,
} from "./nucleo/persistencia.js";
import { clientesDoEco, pausar, pausado, liberado } from "./nucleo/humano.js";
import { usaYCloud, assinaturaValida, paraMeta } from "./nucleo/ycloud.js";
import { downloadMedia } from "./nucleo/media.js";
import { transcribeAudio, transcriptionAvailable } from "./nucleo/transcription.js";

// O negócio. O núcleo acima não sabe qual é: tudo que é dele vem daqui.
// Ver src/exemplo/index.js.
import * as negocio from "./exemplo/index.js";
import { negocio as config } from "./exemplo/config.js";

// Antes de tudo: fuso do negócio no lugar do UTC do servidor.
const FUSO = travarFuso(config.timezone);

// Quando este processo começou. Vira a data de publicação no /health.
const inicio = Date.now();

const app = express();
// Guarda o corpo cru: a assinatura da YCloud é calculada sobre ele, byte a byte.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ---------------------------------------------------------------------------
// Fila por contato
//
// Se a pessoa manda duas mensagens seguidas, os dois webhooks chegam quase
// juntos. Sem fila, os dois leem o mesmo histórico e o segundo sobrescreve o
// primeiro. Aqui cada telefone tem sua própria fila: mensagens do mesmo
// contato saem em ordem, contatos diferentes seguem em paralelo.
// ---------------------------------------------------------------------------
const queues = new Map();

function enqueue(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.then(task, task).catch((err) => console.error("Queued task failed:", err));

  queues.set(key, current);
  current.finally(() => {
    if (queues.get(key) === current) queues.delete(key);
  });

  return current;
}

// Verificação do webhook: só a Meta direto usa (a YCloud não faz este desafio).
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // Pela YCloud, só entra o que vem assinado por ela: o endereço do webhook é
  // público, e sem isto qualquer um falaria com o agente fingindo ser cliente.
  if (usaYCloud() && !assinaturaValida(req.rawBody, req.get("YCloud-Signature"), process.env.YCLOUD_WEBHOOK_SECRET)) {
    console.warn("[ycloud] webhook com assinatura inválida, recusado.");
    return res.sendStatus(401);
  }

  // Responde na hora; o processamento segue depois.
  res.sendStatus(200);

  // Daqui para baixo tudo fala o formato da Meta. Ver nucleo/ycloud.js.
  const body = usaYCloud() ? paraMeta(req.body) : req.body;
  if (!body) return;

  // Coexistência: o dono escreveu pelo app. Aquela conversa fica com ele.
  // Ver nucleo/humano.js.
  const ecos = clientesDoEco(body);
  if (ecos.length) {
    for (const cliente of ecos) {
      pausar(cliente);
      console.log(`[humano] respondeu ${cliente} pelo app; agente calado nessa conversa.`);
    }
    return;
  }

  const incoming = parseIncomingMessage(body);
  if (!incoming) return; // status de entrega e afins

  if (!liberado(incoming.from)) {
    console.log(`[humano] ${incoming.from} fora da lista ATENDER_SOMENTE; fica para o app.`);
    return;
  }
  if (pausado(incoming.from)) {
    console.log(`[humano] ${incoming.from} está com o humano; agente não responde.`);
    return;
  }

  // Reenvio do mesmo webhook: já tratamos, não faz de novo.
  if (alreadyProcessed(incoming.id)) {
    console.log(`Duplicate webhook ignored: ${incoming.id}`);
    return;
  }

  // Texto digitado espera um pouco: quem escreve "oi", "qro corta", "amanha",
  // "c o bruno" em sequência recebe UMA resposta, e não quatro (21/09).
  // Botão e áudio não esperam: primeiro solta o que estava juntando, para a
  // ordem não inverter.
  if (incoming.kind === "text" && incoming.type === "text") {
    juntar(incoming);
  } else {
    soltar(incoming.from);
    enqueue(incoming.from, () => handleMessage(incoming));
  }
});

// ---------------------------------------------------------------------------
// Mensagens em rajada
//
// Cada texto novo do mesmo contato reinicia o relógio. Quando ele passa
// AGRUPAR_MS sem escrever, tudo vira uma mensagem só, uma linha por mensagem.
// AGRUPAR_MS=0 desliga.
// ---------------------------------------------------------------------------
const AGRUPAR_MS = Number(process.env.AGRUPAR_MS ?? 4000);
const juntando = new Map();

function juntar(incoming) {
  if (!AGRUPAR_MS) return void enqueue(incoming.from, () => handleMessage(incoming));
  const j = juntando.get(incoming.from) || { mensagens: [] };
  j.mensagens.push(incoming);
  clearTimeout(j.timer);
  j.timer = setTimeout(() => soltar(incoming.from), AGRUPAR_MS);
  juntando.set(incoming.from, j);
}

function soltar(from) {
  const j = juntando.get(from);
  if (!j) return;
  clearTimeout(j.timer);
  juntando.delete(from);
  const junta = { ...j.mensagens.at(-1), text: j.mensagens.map((m) => m.text).join("\n") };
  enqueue(from, () => handleMessage(junta));
}

/** Áudio vira texto. Foto e o resto caem na resposta educada (null). */
async function audioParaTexto(incoming) {
  const { kind, mediaId, mediaLink, mimeType, from } = incoming;
  if (kind !== "audio" || !transcriptionAvailable()) return null;

  const media = await downloadMedia(mediaId, mediaLink);
  if (media.error) {
    console.error(`Áudio de ${from} não pôde ser baixado: ${media.error}`);
    return null;
  }

  return (await transcribeAudio(media.buffer, media.mimeType || mimeType)) || null;
}

async function handleMessage(incoming) {
  const { from, id, kind, type, contactName, motivo } = incoming;
  let { text } = incoming;

  // Dois tiques azuis + "digitando…" antes de pensar.
  await markAsReadAndTyping(id);

  if (kind === "audio" || kind === "image") {
    try {
      text = await audioParaTexto(incoming);
    } catch (err) {
      console.error(`Falha ao processar ${kind} de ${from}:`, err.message);
      text = null;
    }

    if (!text) {
      await sendWhatsAppMessage(from, unsupportedReplyFor(type));
      return;
    }

    // Transcrever demora. Um segundo "digitando" evita a sensação de abandono.
    await markAsReadAndTyping(id);
  }

  if (kind === "unsupported") {
    console.log(
      `Unsupported message type "${type}" from ${from}` + (motivo ? ` (${motivo})` : " (sem motivo informado)")
    );
    await sendWhatsAppMessage(from, unsupportedReplyFor(type));
    return;
  }

  try {
    const history = getHistory(from);
    history.push({ role: "user", content: text });

    const { reply, updatedHistory } = await getAgentReply(history, from, { contactName, negocio });
    saveHistory(from, updatedHistory);

    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error("Error handling message:", err);
    await sendWhatsAppMessage(from, "Desculpe, tivemos um problema técnico. Um atendente vai te responder em breve.");
  }
}

/**
 * Saúde do agente. A hospedagem bate aqui para saber se a versão nova subiu,
 * e o Rodrigo abre no celular para conferir o que está no ar.
 *
 * Nada aqui pode ser segredo: a URL é pública. Só sim ou não, nunca valores.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    negocio: negocio.rotulo(),
    hospedado: hospedado(),
    whatsapp: usaYCloud() ? "ycloud" : "meta",
    fuso: FUSO.agora,
    estadoEmDisco: ESTADO_EM_DISCO,
    atendeSomenteLista: Boolean(String(process.env.ATENDER_SOMENTE || "").trim()),
    // Qual versão está REALMENTE no ar. A Railway injeta estas variáveis em
    // toda publicação; no PC aparece "local".
    versao: {
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "local").slice(0, 7),
      mensagem: process.env.RAILWAY_GIT_COMMIT_MESSAGE || null,
      publicadoEm: process.env.RAILWAY_DEPLOYMENT_ID ? new Date(inicio).toISOString() : null,
    },
    noArHaSegundos: Math.round(process.uptime()),
  });
});

// Ou o ambiente está certo, ou o agente não sobe. A hospedagem mostra o log da
// falha e mantém a versão anterior no ar, que é o que se quer.
exigirAmbienteValido();

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Agente de WhatsApp (${negocio.rotulo()}) na porta ${port}.`);
  console.log(FUSO.mudou ? `Fuso do servidor era ${FUSO.antes}; agora roda em ${FUSO.agora}.` : `Fuso: ${FUSO.agora}.`);
  console.log(`WhatsApp por: ${usaYCloud() ? "YCloud" : "Meta direto"}.`);
  console.log(
    ESTADO_EM_DISCO
      ? "Conversa: cópia cifrada em disco, sobrevive a reinício."
      : `Conversa: só na memória (${porqueDesligada()}). Reinício apaga o que estava em andamento.`
  );
});

// Publicar versão nova é a hospedagem mandar SIGTERM e esperar alguns
// segundos. É nessa janela que a conversa em andamento é gravada.
instalarGravacaoNoDesligamento({ aoEncerrar: () => server.close(() => process.exit(0)) });
