// O negócio de exemplo: agenda, ferramentas e prompt, sem rede nem chave.
//   node scripts/teste-exemplo.mjs
import { criarVerificador } from "./verificador.mjs";
import { amanhaNoFuso } from "../src/nucleo/datas.js";
import { weekdayInZone } from "../src/nucleo/time.js";
import * as negocio from "../src/exemplo/index.js";
import { __limpar } from "../src/exemplo/agenda.js";

const { check, encerrar } = criarVerificador();
const FUSO = "America/Sao_Paulo";
const TEL = "5511900000001";
const OUTRO = "5511900000002";

// Um dia útil no futuro (amanhã, ou depois se amanhã for domingo).
let DIA = amanhaNoFuso(FUSO);
if (weekdayInZone(DIA, FUSO) === 0) {
  const d = new Date(`${DIA}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  DIA = d.toISOString().slice(0, 10);
}
const tool = (nome, input, tel = TEL) => negocio.runTool(nome, input, tel, { contactName: "Cliente Teste" });

__limpar();
const livres = await tool("ver_horarios", { servico: "corte", data: DIA });
check("dia útil tem horários a partir da abertura", livres.horarios?.[0]?.hora === "09:00");
check("sem profissional, oferece todos", livres.horarios?.[0]?.profissionais.length === 3);

const servicoErrado = await tool("ver_horarios", { servico: "manicure", data: DIA });
check("serviço que não existe vira erro com a lista", /Corte/.test(servicoErrado.erro || ""));

const m = await tool("marcar_horario", { servico: "Corte e barba", data: DIA, hora: "10:00", profissional: "ana", nome_do_cliente: "João" });
check("marca pelo nome, sem acento e minúsculo", m.marcado?.profissional === "Ana" && m.marcado.fim === "11:00");

const dupla = await tool("marcar_horario", { servico: "corte", data: DIA, hora: "10:30", profissional: "Ana", nome_do_cliente: "Maria" }, OUTRO);
check("horário que se sobrepõe pela metade é barrado", Boolean(dupla.erro));

const daAna = await tool("ver_horarios", { servico: "corte", data: DIA, profissional: "Ana" });
check("a Ana some das 10:00 e das 10:30", !daAna.horarios.some((h) => h.hora === "10:00" || h.hora === "10:30"));

const ultimo = (await tool("ver_horarios", { servico: "corte e barba", data: DIA })).horarios.at(-1).hora;
check("serviço de 60 min não começa depois das 18:00", ultimo === "18:00");

const meus = await tool("meus_horarios", {});
check("meus_horarios lista o que este número marcou", meus.horarios.length === 1);

const alheio = await tool("cancelar_horario", { id: m.marcado.id }, OUTRO);
check("ninguém cancela o horário de outro número", Boolean(alheio.erro));
const cancelado = await tool("cancelar_horario", { id: m.marcado.id });
check("o dono do horário cancela", cancelado.cancelado?.id === m.marcado.id);

const domingo = await tool("ver_horarios", { servico: "corte", data: "2030-01-06" });
check("domingo está fechado", domingo.fechado === true);
const passado = await tool("ver_horarios", { servico: "corte", data: "2020-01-07" });
check("data que já passou não tem horário", passado.horarios.length === 0);

const blocos = negocio.buildSystemBlocks({ contactName: "João" });
check("prompt em dois blocos, o estável com cache", blocos.length === 2 && blocos[0].cache_control?.type === "ephemeral");
check("prompt traz o nome do negócio e os preços", blocos[0].text.includes("Studio Exemplo") && blocos[0].text.includes("R$ 80,00"));
check("as 4 ferramentas estão ativas", negocio.toolsAtivas().length === 4);

encerrar();
