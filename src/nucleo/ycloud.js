/**
 * YCloud: o parceiro da Meta que liga a coexistência do negócio
 * (plano grátis, sem mensalidade).
 *
 * O resto do agente continua falando "Meta". Este arquivo faz a ponte nos dois
 * sentidos:
 *
 *   - na ENTRADA, `paraMeta` traduz o evento da YCloud para o formato do
 *     webhook da Meta. Assim parseIncomingMessage e clientesDoEco não mudam.
 *     Dá certo porque a YCloud repete os campos da Meta dentro da mensagem
 *     (text.body, interactive, reaction.message_id, audio.id...).
 *   - na SAÍDA, whatsapp.js e media.js perguntam `usaYCloud()` e trocam só o
 *     endereço e a chave.
 *
 * Liga com WHATSAPP_PROVEDOR=ycloud. Sem a variável, tudo segue direto na Meta,
 * que é como a cobrança e a temporada continuam rodando.
 *
 * Docs: https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver
 */
import crypto from "node:crypto";

export const YCLOUD_API = "https://api.ycloud.com/v2";

export function usaYCloud() {
  return String(process.env.WHATSAPP_PROVEDOR || "").trim().toLowerCase() === "ycloud";
}

export function cabecalhosYCloud() {
  return { "X-API-Key": process.env.YCLOUD_API_KEY, "Content-Type": "application/json" };
}

const soDigitos = (t) => String(t || "").replace(/\D/g, "");

/** A YCloud quer E.164 com "+"; o resto do agente guarda só os dígitos. */
export const e164 = (t) => (soDigitos(t) ? `+${soDigitos(t)}` : "");

/**
 * O webhook veio mesmo da YCloud?
 *
 * Cabeçalho `YCloud-Signature: t=<segundos>,s=<hex>`, onde s é o HMAC-SHA256
 * de `<t>.<corpo cru>` com o segredo do webhook. Corpo CRU: o JSON reescrito
 * muda espaço e ordem e a conta não fecha. Cinco minutos de tolerância contra
 * reenvio de mensagem velha.
 */
export function assinaturaValida(corpoCru, cabecalho, segredo, agora = Date.now()) {
  if (!Buffer.isBuffer(corpoCru) || typeof cabecalho !== "string" || !segredo) return false;
  const campos = cabecalho.split(",").map((p) => p.trim().split("="));
  const ts = campos.filter(([k]) => k === "t").map(([, v]) => v);
  const assinaturas = campos.filter(([k]) => k === "s").map(([, v]) => v);
  if (ts.length !== 1 || !/^\d+$/.test(ts[0])) return false;
  if (Math.abs(Math.floor(agora / 1000) - Number(ts[0])) > 300) return false;

  const esperado = crypto.createHmac("sha256", segredo).update(`${ts[0]}.`).update(corpoCru).digest();
  return assinaturas.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s || "")) return false;
    const recebido = Buffer.from(s, "hex");
    return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  });
}

const naMeta = (field, value) => ({ entry: [{ changes: [{ field, value }] }] });

/**
 * Evento da YCloud no formato do webhook da Meta. Null para o que o agente não
 * usa (status de entrega, modelo aprovado...): o webhook trata como "nada a
 * responder".
 *
 * O id vira o wamid, que é o que a reação do cliente cita e o que a YCloud
 * aceita para marcar como lida.
 *
 * shortcut: cliente que só tem BSUID (sem telefone, novidade da Meta em 2026)
 * é ignorado. Resolver se aparecer no log "[ycloud] mensagem sem telefone".
 */
export function paraMeta(evento) {
  if (evento?.type === "whatsapp.inbound_message.received") {
    const { id, wamid, from, customerProfile, ...resto } = evento.whatsappInboundMessage || {};
    if (!soDigitos(from)) {
      console.log("[ycloud] mensagem sem telefone, ignorada.");
      return null;
    }
    return naMeta("messages", {
      contacts: [{ profile: { name: customerProfile?.name || null } }],
      messages: [{ ...resto, id: wamid || id, from: soDigitos(from) }],
    });
  }

  if (evento?.type === "whatsapp.smb.message.echoes") {
    const m = evento.whatsappMessage || {};
    if (!soDigitos(m.to)) return null;
    return naMeta("smb_message_echoes", {
      message_echoes: [{ ...m, id: m.wamid || m.id, from: soDigitos(m.from), to: soDigitos(m.to) }],
    });
  }

  return null;
}

/** A mídia vem por link da própria YCloud; a chave só vai para ela. */
export function linkDaYCloud(link) {
  try {
    return new URL(link).hostname === "api.ycloud.com";
  } catch {
    return false;
  }
}
