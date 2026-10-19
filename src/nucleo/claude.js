import Anthropic from "@anthropic-ai/sdk";
// O núcleo não sabe qual negócio atende: quem chama passa o módulo dele
// (buildSystemBlocks, toolsAtivas, runTool e, se quiser, ajustarResposta).
// Ver src/exemplo/index.js.
import { registrarUso, linhaDaMensagem, resumo } from "./custo.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";

// 1000 era pouco. A chamada de save_insurance_data carrega ~15 campos, e a
// resposta era cortada no meio da geração — sobrava um bloco incompleto, sem
// texto e sem ferramenta utilizável, e o paciente recebia "pode repetir?".
// O custo de um teto maior é zero quando não se usa: cobra-se o que é gerado.
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS || 4000);

const MAX_TOOL_ROUNDS = 6;

const GENERIC_FALLBACK =
  "Desculpe, me perdi aqui. Pode repetir a última mensagem?";

/**
 * O que uma ferramenta devolve, no formato que a API aceita.
 *
 * O `content` de um tool_result só pode ser TEXTO (ou uma lista de blocos).
 * Clínica, temporada e cobrança devolvem `JSON.stringify(...)`; a barbearia
 * devolvia o objeto cru — e em 21/09, na primeira conversa de verdade, a API
 * recusou com 400 e o cliente recebeu "tivemos um problema técnico".
 *
 * Resolver AQUI, e não em cada negócio, é o que impede o quinto negócio de
 * repetir o erro: todo resultado de ferramenta passa por este ponto.
 */
export function comoConteudo(result) {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";
  // Lista de blocos de verdade ({ type: "text", ... }) passa como está. Uma
  // lista de DADOS (horários, barbeiros) seria recusada do mesmo jeito que o
  // objeto — vira texto.
  const ehBloco = (b) => b && typeof b === "object" && typeof b.type === "string";
  if (Array.isArray(result) && result.length && result.every(ehBloco)) return result;
  return JSON.stringify(result);
}

/**
 * Sends the conversation to Claude, executes any tool calls it requests,
 * and loops until Claude produces a final text reply for the patient.
 */
export async function getAgentReply(history, patientPhone, { contactName, negocio } = {}) {
  const messages = [...history];
  const system = negocio.buildSystemBlocks({ contactName, telefone: patientPhone });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: negocio.toolsAtivas(),
      messages,
    });

    // Cada rodada de ferramenta é uma chamada cobrada. Medir por rodada, e
    // não só no fim, é o que mostra que o custo mora no número de rodadas.
    registrarUso(patientPhone, response.usage, MODEL);

    const toolUses = response.content.filter((block) => block.type === "tool_use");
    const textBlock = response.content.find((block) => block.type === "text");

    // Resposta truncada: sem isto, a falha é silenciosa e vira "pode repetir?"
    // eternamente, sem nenhuma pista no log de por que aconteceu.
    if (response.stop_reason === "max_tokens") {
      console.error(
        `[agente] resposta truncada por max_tokens (${MAX_TOKENS}) na rodada ${round}. ` +
          `Blocos: ${response.content.map((b) => b.type).join(",") || "nenhum"}. ` +
          "Aumente AGENT_MAX_TOKENS."
      );
    }

    if (toolUses.length === 0) {
      if (textBlock?.text) {
        messages.push({ role: "assistant", content: response.content });
        const linha = linhaDaMensagem(patientPhone);
        if (linha) {
          console.log(linha);
          console.log(resumo().texto);
        }
        // Cada negócio pode corrigir a forma da resposta antes de ela sair (a
        // barbearia põe os botões de barbeiro que o modelo esqueceu). Não
        // mexe no histórico: o modelo continua vendo o que ele mesmo escreveu.
        const reply = negocio.ajustarResposta ? negocio.ajustarResposta(textBlock.text) : textBlock.text;
        return { reply, updatedHistory: messages };
      }

      // Nem texto nem ferramenta. Antes isso caía num "pode repetir?" mudo.
      // Agora registramos o suficiente para diagnosticar sem adivinhação.
      console.error(
        `[agente] resposta sem texto e sem ferramenta na rodada ${round}. ` +
          `stop_reason=${response.stop_reason}. ` +
          `Blocos: ${response.content.map((b) => b.type).join(",") || "nenhum"}. ` +
          `Tokens: entrada=${response.usage?.input_tokens}, saída=${response.usage?.output_tokens}.`
      );

      // Não devolve o histórico sujo: a mensagem vazia do assistente
      // envenenaria as próximas rodadas.
      return { reply: GENERIC_FALLBACK, updatedHistory: history };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUses.map(async (toolUse) => {
        let result;
        try {
          // O quarto argumento é contexto da conversa. A clínica ignora; o
          // agente de temporada usa o nome para identificar o hóspede no
          // alerta que chega ao anfitrião de madrugada.
          result = await negocio.runTool(toolUse.name, toolUse.input || {}, patientPhone, {
            contactName,
          });
        } catch (err) {
          // Uma ferramenta que estoura não pode derrubar a conversa.
          console.error(`[agente] tool ${toolUse.name} falhou:`, err);
          result = JSON.stringify({
            error: "Tool execution failed.",
            detail: err?.message || String(err),
            instruction:
              "Explique ao paciente que houve um problema técnico nesta etapa, ofereça " +
              "continuar por outro caminho, e não repita o erro técnico.",
          });
        }

        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: comoConteudo(result),
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  console.error(
    `[agente] limite de ${MAX_TOOL_ROUNDS} rodadas de ferramenta atingido para ${patientPhone}.`
  );

  return {
    reply:
      "Desculpe, tive um problema para concluir isso agora. Pode tentar de novo em instantes, " +
      "ou pedir para falar com uma pessoa?",
    updatedHistory: history,
  };
}
