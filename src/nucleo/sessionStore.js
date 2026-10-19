// Histórico de conversa, por telefone.
//
// Continua sendo um Map na memória, e é ele que responde a toda leitura: nada
// aqui ficou mais lento. O disco entra só como cópia de segurança, cifrada e
// gravada com atraso, para a conversa sobreviver a uma publicação de versão.
// Sem STATE_DIR e STATE_KEY, a cópia não existe e o comportamento é o de
// sempre. Ver state/persistencia.js.

import { arquivoDeEstado } from "./persistencia.js";

const disco = arquivoDeEstado("conversas", ["sessions", "processados"]);
const { sessions, processados } = disco.registrar(disco.carregar());

const SESSION_TTL_MS = 1000 * 60 * 60 * 2; // 2h de inatividade limpa a conversa

// Histórico longo demais custa caro em tokens e não melhora a resposta.
// Mantemos as últimas trocas e descartamos o começo.
const MAX_MESSAGES = 40;

export function getHistory(phone) {
  const session = sessions.get(phone);
  if (!session) return [];
  if (Date.now() - session.lastActive > SESSION_TTL_MS) {
    sessions.delete(phone);
    disco.salvar();
    return [];
  }
  return session.messages;
}

export function saveHistory(phone, messages) {
  let trimmed = messages;

  if (messages.length > MAX_MESSAGES) {
    trimmed = messages.slice(-MAX_MESSAGES);

    // O histórico não pode começar com um tool_result órfão — a API rejeita.
    // Avança até encontrar uma mensagem de usuário que seja texto de verdade.
    while (trimmed.length > 0) {
      const first = trimmed[0];
      const isOrphanToolResult =
        first.role === "user" &&
        Array.isArray(first.content) &&
        first.content.some((block) => block.type === "tool_result");
      const isAssistant = first.role === "assistant";

      if (isOrphanToolResult || isAssistant) trimmed = trimmed.slice(1);
      else break;
    }
  }

  sessions.set(phone, { messages: trimmed, lastActive: Date.now() });
  disco.salvar();
}

export function clearHistory(phone) {
  sessions.delete(phone);
  disco.salvar();
}

// ---------------------------------------------------------------------------
// Idempotência
//
// A Meta reenvia o mesmo webhook quando não recebe o 200 a tempo, ou por
// redundância interna. Sem esta trava, um reenvio faria o agente responder
// duas vezes — e, no pior caso, agendar a mesma consulta duas vezes.
//
// ESTA LISTA VAI PARA O DISCO, junto com as conversas. Antes não ia, e o
// comentário que estava aqui dizia que a janela de reenvio da Meta era de
// minutos, curta demais para sobreviver a uma publicação. Estava errado, e o
// erro apareceu em 25/08: o agente mandou "Como posso te ajudar, Rodrigo?"
// sozinho, mais de uma hora depois da última mensagem, em cima de um reinício.
//
// O raciocínio errado era o de sempre: eu escolhi o prazo que me convinha em
// vez de medir o da Meta. E era justamente o reinício — o momento em que a
// memória sumia — que reabria a porta.
//
// Guardar id de mensagem não é guardar mensagem: são identificadores, e vão no
// mesmo arquivo cifrado das conversas. Cabem cinco mil, o que é muito mais do
// que qualquer clínica recebe em um dia.
// ---------------------------------------------------------------------------

const processedIds = processados;
const PROCESSED_TTL_MS = 1000 * 60 * 60 * 24; // 24h cobre reenvio tardio da Meta
const PROCESSED_MAX = 5000;

// Limpeza no arranque: id vencido não protege de nada e só engorda o arquivo.
for (const [id, ts] of processedIds) {
  if (Date.now() - ts >= PROCESSED_TTL_MS) processedIds.delete(id);
}

export function alreadyProcessed(messageId) {
  if (!messageId) return false;

  const seenAt = processedIds.get(messageId);
  if (seenAt && Date.now() - seenAt < PROCESSED_TTL_MS) return true;

  processedIds.set(messageId, Date.now());

  // Limpeza preguiçosa: só varre quando o mapa cresce, para não rodar timer à toa.
  if (processedIds.size > PROCESSED_MAX) {
    const cutoff = Date.now() - PROCESSED_TTL_MS;
    for (const [id, ts] of processedIds) {
      if (ts < cutoff) processedIds.delete(id);
    }
    // Ainda grande depois da varredura: descarta os mais antigos. A trava tem
    // que ter teto, senão um dia de tráfego anormal vira arquivo sem fim.
    if (processedIds.size > PROCESSED_MAX) {
      const sobrando = [...processedIds.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, processedIds.size - PROCESSED_MAX);
      for (const [id] of sobrando) processedIds.delete(id);
    }
  }

  // Gravação com atraso, como a das conversas: o custo é o mesmo de salvar uma
  // resposta, e é isto que faz a trava sobreviver à publicação de uma versão.
  disco.salvar();

  return false;
}
