/**
 * Quanto custa cada conversa.
 *
 * Existe por uma razão comercial, não técnica: sem este número, qualquer
 * mensalidade é chute. Uma clínica movimentada pode consumir mais do que se
 * cobra dela, e o pior é que quanto MAIS ela usar, mais se perde. Isso não é
 * preço baixo, é modelo quebrado, e só aparece na fatura do mês seguinte.
 *
 * O que se mede aqui é só o custo do modelo. Fora daqui ficam a hospedagem
 * (fixa, entre US$5 e US$10/mês) e a transcrição de áudio, se ligada
 * (US$0,006 por minuto). Resposta de serviço no WhatsApp dentro da janela de
 * 24h é gratuita, que é o caso de tudo que o agente faz.
 */

// Preços por MILHÃO de tokens, em dólar.
// Fonte: platform.claude.com/docs/en/about-claude/pricing, conferido em 20/08/2026.
const TABELA = {
  "claude-sonnet-5": { entrada: 2, saida: 10, cacheEscrita: 2.5, cacheLeitura: 0.2 },
  "claude-opus-5": { entrada: 5, saida: 25, cacheEscrita: 6.25, cacheLeitura: 0.5 },
  "claude-haiku-4.5": { entrada: 1, saida: 5, cacheEscrita: 1.25, cacheLeitura: 0.1 },
};

const PADRAO = TABELA["claude-sonnet-5"];

// Ajuste no .env conforme o câmbio do dia. O dólar é a conta exata; o real é
// conveniência para você conversar sobre mensalidade em reais.
const USD_BRL = Number(process.env.USD_BRL || 5.4);

function precos(modelo) {
  return TABELA[modelo] || PADRAO;
}

// Uma conversa por telefone. Depois de 2h sem mensagem ela é dada por
// encerrada e entra na média, que é a mesma janela do histórico do agente.
const JANELA_MS = 2 * 60 * 60 * 1000;

const abertas = new Map();
const total = { conversas: 0, usd: 0, chamadas: 0 };

function nova() {
  return {
    entrada: 0,
    saida: 0,
    cacheEscrita: 0,
    cacheLeitura: 0,
    usd: 0,
    chamadas: 0,
    ultima: Date.now(),
  };
}

function fechar(telefone, conversa) {
  total.conversas++;
  total.usd += conversa.usd;
  total.chamadas += conversa.chamadas;
  abertas.delete(telefone);
}

/** Fecha conversas paradas há mais de 2h, para a média não ficar presa. */
function expirar() {
  const agora = Date.now();
  for (const [telefone, conversa] of abertas) {
    if (agora - conversa.ultima > JANELA_MS) fechar(telefone, conversa);
  }
}

/**
 * Registra o consumo de UMA chamada ao modelo.
 * Uma mensagem do paciente costuma gerar várias, uma por rodada de ferramenta.
 */
export function registrarUso(telefone, usage, modelo) {
  if (!usage) return null;

  expirar();

  const p = precos(modelo);
  const entrada = usage.input_tokens || 0;
  const saida = usage.output_tokens || 0;
  const cacheEscrita = usage.cache_creation_input_tokens || 0;
  const cacheLeitura = usage.cache_read_input_tokens || 0;

  const usd =
    (entrada * p.entrada +
      saida * p.saida +
      cacheEscrita * p.cacheEscrita +
      cacheLeitura * p.cacheLeitura) /
    1_000_000;

  const conversa = abertas.get(telefone) || nova();
  conversa.entrada += entrada;
  conversa.saida += saida;
  conversa.cacheEscrita += cacheEscrita;
  conversa.cacheLeitura += cacheLeitura;
  conversa.usd += usd;
  conversa.chamadas++;
  conversa.ultima = Date.now();
  abertas.set(telefone, conversa);

  return { usd, conversa };
}

const brl = (usd) => (usd * USD_BRL).toFixed(2).replace(".", ",");
const cents = (usd) => `US$ ${usd.toFixed(4)}`;

/**
 * Linha de log ao fim de cada mensagem respondida.
 * Sem telefone completo: o log não é lugar de dado de paciente.
 */
export function linhaDaMensagem(telefone) {
  const c = abertas.get(telefone);
  if (!c) return null;

  const fim = String(telefone).slice(-4);
  const cacheado = c.cacheLeitura > 0 ? `, cache lido ${c.cacheLeitura}` : "";

  return (
    `[custo] ...${fim}: ${c.chamadas} chamada(s), ` +
    `entrada ${c.entrada}${cacheado}, saída ${c.saida} tokens. ` +
    `Conversa até aqui: ${cents(c.usd)} (R$ ${brl(c.usd)})`
  );
}

/** Média por conversa encerrada, que é o número que decide a mensalidade. */
export function resumo() {
  expirar();

  const emAberto = [...abertas.values()].reduce((s, c) => s + c.usd, 0);
  const conversas = total.conversas;
  const media = conversas ? total.usd / conversas : 0;

  return {
    conversasEncerradas: conversas,
    conversasAbertas: abertas.size,
    usdTotal: total.usd + emAberto,
    usdMediaPorConversa: media,
    projecao200: media * 200,
    texto: conversas
      ? `[custo] média por conversa: ${cents(media)} (R$ ${brl(media)}) ` +
        `em ${conversas} conversa(s). A 200 conversas/mês: ` +
        `US$ ${(media * 200).toFixed(2)} (R$ ${brl(media * 200)}).`
      : `[custo] nenhuma conversa encerrada ainda. ${abertas.size} em andamento, ` +
        `${cents(emAberto)} até agora.`,
  };
}

/** Fecha tudo e devolve o resumo. Útil ao terminar uma bateria de testes. */
export function encerrarTudo() {
  for (const [telefone, conversa] of [...abertas]) fechar(telefone, conversa);
  return resumo();
}
