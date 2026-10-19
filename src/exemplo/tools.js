/**
 * As ferramentas do agente de exemplo. O modelo fala por NOME ("Ana",
 * "corte"); a agenda é a única fonte da verdade, nada de horário inventado.
 */
import { horariosLivres, marcar, doCliente, cancelar } from "./agenda.js";

const DATA = "Data no formato AAAA-MM-DD. Resolva 'hoje', 'amanhã', 'sábado' pela data atual do prompt.";

export const toolDefinitions = [
  {
    name: "ver_horarios",
    description:
      "Horários livres de um serviço numa data. Use SEMPRE antes de falar qualquer horário. " +
      "Sem profissional, procura em todos.",
    input_schema: {
      type: "object",
      properties: {
        servico: { type: "string", description: "Nome do serviço, como está na lista do prompt." },
        data: { type: "string", description: DATA },
        profissional: { type: "string", description: "Nome do profissional, se o cliente escolheu um." },
      },
      required: ["servico", "data"],
    },
  },
  {
    name: "marcar_horario",
    description: "Marca o horário. Só depois de o cliente confirmar serviço, data, hora e profissional.",
    input_schema: {
      type: "object",
      properties: {
        servico: { type: "string" },
        data: { type: "string", description: DATA },
        hora: { type: "string", description: "HH:MM, um dos horários que ver_horarios devolveu." },
        profissional: { type: "string" },
        nome_do_cliente: { type: "string", description: "Nome de quem vai ser atendido." },
      },
      required: ["servico", "data", "hora", "profissional", "nome_do_cliente"],
    },
  },
  {
    name: "meus_horarios",
    description: "Lista os próximos horários marcados por este número de WhatsApp.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancelar_horario",
    description: "Cancela um horário deste número. Pegue o id em meus_horarios e confirme com o cliente antes.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
];

export const toolsAtivas = () => toolDefinitions;

export async function runTool(nome, input = {}, telefone, { contactName } = {}) {
  switch (nome) {
    case "ver_horarios":
      return horariosLivres(input);
    case "marcar_horario":
      return marcar({ ...input, nome: input.nome_do_cliente || contactName, telefone });
    case "meus_horarios":
      return { horarios: doCliente(telefone) };
    case "cancelar_horario":
      return cancelar(input.id, telefone);
    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}
