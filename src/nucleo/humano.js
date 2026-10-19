/**
 * Quem o agente atende, e quando ele se cala.
 *
 * COEXISTÊNCIA (07/10). O número oficial do negócio vai funcionar no
 * app WhatsApp Business do dono E no agente ao mesmo tempo. Duas regras
 * saem disso:
 *
 * 1. LISTA DE LIBERADOS. No começo o agente só responde aos números de
 *    `ATENDER_SOMENTE` (separados por vírgula). O resto dos clientes segue
 *    falando com o dono pelo app, como sempre. Vazia = atende todo mundo.
 *    O dono (DONO_TELEFONE) passa sempre: é por ele que chega o
 *    "Sim/Não" do pedido de conversa.
 *
 * 2. O DONO RESPONDEU, O AGENTE SE CALA. Quando ele escreve pelo app (ou pelo
 *    WhatsApp Web da loja), a Meta manda um "eco" no webhook, campo
 *    `smb_message_echoes`. A conversa com aquele cliente fica com o humano por
 *    `PAUSA_HUMANO_MIN` minutos (padrão 240) a partir da última mensagem dele.
 *
 * shortcut: a pausa vive na memória do processo. Reiniciou, o agente volta a
 * responder antes da hora. Se incomodar, guardar em state/persistencia.js.
 *
 * shortcut: o eco não diz QUAL aparelho mandou. Se o robô do ClickBarber
 * voltar a ser aparelho conectado, cada lembrete dele também cala o agente para
 * aquele cliente. Só resolver se o robô realmente voltar.
 */
const soDigitos = (t) => String(t || "").replace(/\D/g, "");

const pausados = new Map(); // telefone -> até quando (ms)

function pausaMs() {
  return Number(process.env.PAUSA_HUMANO_MIN ?? 240) * 60 * 1000;
}

/** Telefones dos clientes a quem o humano acabou de escrever pelo app. */
export function clientesDoEco(body) {
  const clientes = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "smb_message_echoes") continue;
      for (const eco of change.value?.message_echoes || []) {
        if (eco?.to) clientes.push(soDigitos(eco.to));
      }
    }
  }
  return clientes;
}

export function pausar(telefone, agora = Date.now()) {
  pausados.set(soDigitos(telefone), agora + pausaMs());
}

export function pausado(telefone, agora = Date.now()) {
  const ate = pausados.get(soDigitos(telefone));
  if (!ate) return false;
  if (agora < ate) return true;
  pausados.delete(soDigitos(telefone));
  return false;
}

/** O agente pode responder a este número? */
export function liberado(telefone, dono = process.env.DONO_TELEFONE) {
  const lista = String(process.env.ATENDER_SOMENTE || "")
    .split(",")
    .map(soDigitos)
    .filter(Boolean);
  if (!lista.length) return true;
  const t = soDigitos(telefone);
  // Compara pelo final: a Meta manda 5521..., e alguém pode escrever 21... na lista.
  const bate = (n) => n && (t.endsWith(n) || n.endsWith(t));
  return lista.some(bate) || bate(soDigitos(dono));
}

/** Só para teste. */
export function __esquecerPausas() {
  pausados.clear();
}
