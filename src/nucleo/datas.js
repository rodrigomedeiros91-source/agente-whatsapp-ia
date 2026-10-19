/**
 * Datas e nomes do jeito que se escreve no WhatsApp. Usado pelo lembrete.
 *
 * Vieram de services/lembretes.js do projeto antigo, que era o lembrete da
 * clínica e puxava Google Agenda junto. Aqui ficou só o que serve a qualquer
 * negócio, com o fuso passado por quem chama.
 */
import { nowInZone } from "./time.js";

/**
 * Só o primeiro nome. "Maria Clara" vira "Maria" de vez em quando, mas não há
 * heurística honesta que separe nome composto de sobrenome sem uma lista que
 * envelhece mal. Primeiro nome e pronto.
 */
export function primeiroNome(completo) {
  const partes = String(completo || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  return partes[0];
}

/** "14:30" -> "14h30". "14:00" -> "14h". Como gente escreve no WhatsApp. */
export function horaFalada(hhmm) {
  const [h, m] = String(hhmm || "").split(":");
  if (!h) return String(hhmm || "");
  return m && m !== "00" ? `${Number(h)}h${m}` : `${Number(h)}h`;
}

/** A data de amanhã no fuso do negócio, sem depender do fuso do servidor. */
export function amanhaNoFuso(fuso = "America/Sao_Paulo") {
  const hoje = nowInZone(fuso).isoDate;
  const [a, m, d] = hoje.split("-").map(Number);
  // Meio-dia UTC evita que somar um dia caia na virada e mude a data por
  // causa do horário de verão.
  const proximo = new Date(Date.UTC(a, m - 1, d, 12, 0, 0) + 86400000);
  return proximo.toISOString().slice(0, 10);
}
