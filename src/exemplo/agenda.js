/**
 * A agenda do negócio de exemplo.
 *
 * shortcut: vive na memória do processo, reinício apaga tudo. Em produção este
 * arquivo vira o cliente da agenda de verdade (ClickBarber, Google Agenda...),
 * com as mesmas funções; tools.js não muda.
 */
import { negocio } from "./config.js";
import { nowInZone, weekdayInZone, addMinutes } from "../nucleo/time.js";

const PASSO = 30; // minutos entre um horário e o próximo
let marcados = [];
let proximoId = 1;

const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export const acharServico = (nome) => negocio.servicos.find((s) => normal(s.nome) === normal(nome));
export const acharProfissional = (nome) =>
  negocio.profissionais.find((p) => normal(p) === normal(nome) || normal(p) === normal(nome).split(" ")[0]);

const seSobrepoem = (a, b) => a.inicio < b.fim && b.inicio < a.fim;

function jaPassou(data, hora) {
  const { isoDate, time } = nowInZone(negocio.timezone);
  return data < isoDate || (data === isoDate && hora <= time);
}

function livre(profissional, data, inicio, fim) {
  return !marcados.some((m) => m.profissional === profissional && m.data === data && seSobrepoem(m, { inicio, fim }));
}

/** Horários livres de um serviço numa data, por profissional. */
export function horariosLivres({ servico, data, profissional }) {
  const s = acharServico(servico);
  if (!s) return { erro: `Serviço "${servico}" não existe. Serviços: ${negocio.servicos.map((x) => x.nome).join(", ")}.` };
  if (negocio.fechadoNoDia.includes(weekdayInZone(data, negocio.timezone))) return { fechado: true, horarios: [] };

  const quem = profissional ? [acharProfissional(profissional)].filter(Boolean) : negocio.profissionais;
  if (!quem.length) return { erro: `Não temos "${profissional}". Profissionais: ${negocio.profissionais.join(", ")}.` };

  const horarios = [];
  for (let hora = negocio.abre; addMinutes(hora, s.minutos) <= negocio.fecha; hora = addMinutes(hora, PASSO)) {
    if (jaPassou(data, hora)) continue;
    const comQuem = quem.filter((p) => livre(p, data, hora, addMinutes(hora, s.minutos)));
    if (comQuem.length) horarios.push({ hora, profissionais: comQuem });
  }
  return { horarios };
}

/** Marca, conferindo de novo na hora: entre ver e marcar, outro cliente pode ter pego o horário. */
export function marcar({ servico, data, hora, profissional, nome, telefone }) {
  const s = acharServico(servico);
  const p = acharProfissional(profissional);
  if (!s || !p) return { erro: "Serviço ou profissional não encontrado. Consulte os horários de novo." };
  if (jaPassou(data, hora)) return { erro: "Esse horário já passou." };

  const fim = addMinutes(hora, s.minutos);
  const disponivel = horariosLivres({ servico: s.nome, data, profissional: p }).horarios?.some((h) => h.hora === hora);
  if (!disponivel || !livre(p, data, hora, fim)) return { erro: "Esse horário acabou de ser ocupado. Ofereça outros." };

  const ag = { id: proximoId++, servico: s.nome, preco: s.preco, data, inicio: hora, fim, profissional: p, nome, telefone };
  marcados.push(ag);
  return { marcado: ag };
}

/** Os próximos horários deste telefone. */
export function doCliente(telefone) {
  return marcados.filter((m) => m.telefone === telefone && !jaPassou(m.data, m.inicio));
}

/** Só cancela horário do próprio telefone: ninguém desmarca o de outra pessoa. */
export function cancelar(id, telefone) {
  const ag = marcados.find((m) => m.id === Number(id) && m.telefone === telefone);
  if (!ag) return { erro: "Não achei esse horário no seu número." };
  marcados = marcados.filter((m) => m !== ag);
  return { cancelado: ag };
}

export function __limpar() {
  marcados = [];
  proximoId = 1;
}
