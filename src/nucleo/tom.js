/**
 * O que NENHUM agente deste projeto escreve, em nenhum negócio.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O Rodrigo proibiu expressão cafona — "Poxa, sinto muito" e parentes — em
 * todos os agentes, passados e futuros. E o prompt da clínica ensinava
 * exatamente isso como exemplo de resposta BOA para queixa de paciente.
 *
 * Exemplo ensina mais que regra: foi assim que a barbearia descobriu que
 * "Tanto faz" continuava saindo depois de três proibições escritas com todas
 * as letras. A lição ficou no STATUS-BARBEARIA: instrução no prompt é pedido,
 * peneira na saída é garantia. Aqui é a garantia.
 *
 * DUAS LISTAS, E O MOTIVO
 *
 * "Poxa", "Puxa" e "Nossa" só são cafonas como INTERJEIÇÃO — abrindo a frase e
 * seguidas de vírgula ou exclamação. "Nossa equipe" e "o prompt puxa mais" são
 * português normal, e uma peneira que os apagasse estragaria texto certo. Já
 * "sinto muito" e "fique tranquilo" são cafonas em qualquer posição.
 *
 * A PENEIRA É CONSERVADORA DE PROPÓSITO
 *
 * Ela corta a oração inteira onde a expressão abre — do começo do texto ou
 * depois de um ponto até a próxima pontuação forte — e para no "[", para não
 * engolir o marcador [[opcoes: ...]] que vira botão do WhatsApp logo depois.
 * Nunca reescreve o meio de uma frase: estragar texto certo é pior do que
 * deixar passar um "poxa" que ninguém notou.
 */

/** Cafonas em qualquer posição. */
const FRASES = [
  "sinto muito",
  "que pena",
  "fico feliz em ajudar",
  "estou aqui para o que precisar",
  "não se preocupe",
  "nao se preocupe",
  "fique tranquilo",
  "fique tranquila",
  "ótima pergunta",
  "otima pergunta",
];

/** Cafonas só como interjeição: abrindo a frase, com vírgula ou exclamação. */
const INTERJEICOES = ["poxa", "puxa", "nossa"];

function escapar(expressao) {
  return expressao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A oração que a expressão abre, para a peneira apagar. */
function padraoDeCorte(expressao, interjeicao) {
  const alvo = escapar(expressao) + (interjeicao ? "\\s*[,!…]" : "");
  return new RegExp(`(^|[.!?]\\s+)${alvo}[^.!?\\[]*[.!?]\\s*`, "gi");
}

/** A expressão em qualquer lugar do texto, para a varredura do prompt. */
function padraoDeBusca(expressao, interjeicao) {
  return interjeicao
    ? new RegExp(`(^|[.!?]\\s+|["'“])${escapar(expressao)}\\s*[,!…]`, "iu")
    : new RegExp(`(^|[^\\p{L}])${escapar(expressao)}([^\\p{L}]|$)`, "iu");
}

const TODAS = [
  ...FRASES.map((e) => ({ expressao: e, interjeicao: false })),
  ...INTERJEICOES.map((e) => ({ expressao: e, interjeicao: true })),
];

/** Tira as expressões proibidas. Nunca lança; null vira "". */
export function peneirarTom(texto) {
  let saida = String(texto ?? "");
  for (const { expressao, interjeicao } of TODAS) {
    saida = saida.replace(padraoDeCorte(expressao, interjeicao), (_, antes) => antes || "");
  }
  return saida.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Quais expressões proibidas aparecem num texto, em qualquer posição.
 *
 * Aqui a busca é larga de propósito, ao contrário da peneira: serve para o
 * teste varrer o prompt montado de cada negócio, e no prompt a expressão
 * aparece dentro de exemplo, entre aspas, depois de dois-pontos — nunca
 * abrindo uma frase. Era esse o caso que originou a regra:
 *
 *   BOM: "Poxa, sinto muito. Isso quem precisa olhar é a profissional..."
 *
 * Detectar tem que ser largo; apagar tem que ser estreito.
 */
export function expressoesCafonas(texto) {
  const alvo = String(texto ?? "");
  return TODAS.filter(({ expressao, interjeicao }) =>
    padraoDeBusca(expressao, interjeicao).test(alvo)
  ).map(({ expressao }) => expressao);
}
