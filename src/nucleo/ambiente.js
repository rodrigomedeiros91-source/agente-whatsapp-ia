/**
 * O que muda quando o agente sai do PC do Rodrigo e vai para um servidor.
 *
 * No PC, esquecer uma variável dá no máximo um susto: ele vê o terminal,
 * corrige e reinicia. Hospedado, ninguém está olhando o terminal. Este arquivo
 * transforma erro silencioso em erro barulhento: ou o agente sobe certo, ou
 * ele não sobe.
 */

/**
 * Pistas que os provedores deixam no ambiente. Nenhum código nosso precisa
 * saber qual deles é; basta saber que não é mais a máquina de casa.
 */
const PISTAS_DE_PROVEDOR = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "RENDER",
  "RENDER_SERVICE_ID",
  "FLY_APP_NAME",
  "DYNO",
  "KOYEB_APP_NAME",
  "K_SERVICE",
];

/**
 * Estamos hospedados? HOSTED manda em tudo, nos dois sentidos: serve para
 * testar o modo hospedado no PC (HOSTED=true) e para rodar em servidor sem as
 * travas (HOSTED=false).
 */
export function hospedado() {
  const forcado = String(process.env.HOSTED || "").trim().toLowerCase();
  if (["1", "true", "sim"].includes(forcado)) return true;
  if (["0", "false", "nao", "não"].includes(forcado)) return false;
  return PISTAS_DE_PROVEDOR.some((chave) => process.env[chave]);
}

/**
 * Servidor hospedado roda em UTC. O código de data já usa o fuso explícito
 * (ver time.js); isto deixa o log legível e faz código novo que esquecer o
 * fuso errar no fuso certo. Precisa rodar antes de qualquer coisa que leia
 * data, por isso é chamado no topo do server.js.
 */
export function travarFuso(desejado) {
  const antes = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (antes !== desejado) process.env.TZ = desejado;
  return {
    antes,
    agora: Intl.DateTimeFormat().resolvedOptions().timeZone,
    desejado,
    mudou: antes !== desejado,
  };
}

const OBRIGATORIAS = [["ANTHROPIC_API_KEY", "sem ela o agente não pensa"]];

/** As do WhatsApp dependem de quem entrega a mensagem (WHATSAPP_PROVEDOR). */
const DO_WHATSAPP = {
  meta: [
    ["WHATSAPP_TOKEN", "sem ele o agente não responde ninguém"],
    ["WHATSAPP_PHONE_NUMBER_ID", "sem ele não há de qual número enviar"],
    ["WHATSAPP_VERIFY_TOKEN", "sem ele a Meta não valida o webhook"],
  ],
  ycloud: [
    ["YCLOUD_API_KEY", "sem ela o agente não responde ninguém"],
    ["YCLOUD_NUMERO", "sem ele não há de qual número enviar"],
    ["YCLOUD_WEBHOOK_SECRET", "sem ele toda mensagem da YCloud é recusada como não assinada"],
  ],
};

/**
 * Confere o ambiente. `erros` impedem o arranque; `avisos` não impedem, mas
 * são coisas que já custaram tempo antes e que ninguém lembra de conferir.
 *
 * `exigir` é a lista do NEGÓCIO (ex.: o token da agenda que ele usa):
 * o núcleo não sabe qual negócio está rodando.
 */
export function conferirAmbiente({ exigir = [] } = {}) {
  const erros = [];
  const avisos = [];
  const emServidor = hospedado();

  const provedor = String(process.env.WHATSAPP_PROVEDOR || "meta").trim().toLowerCase();
  if (!DO_WHATSAPP[provedor]) {
    erros.push(`WHATSAPP_PROVEDOR="${provedor}" não existe. Use "meta" (ou deixe vazia) ou "ycloud".`);
  }

  for (const [nome, porque] of [...OBRIGATORIAS, ...(DO_WHATSAPP[provedor] || []), ...exigir]) {
    if (!process.env[nome]) erros.push(`${nome} não está definida (${porque}).`);
  }

  if (emServidor && (!process.env.STATE_DIR || !process.env.STATE_KEY)) {
    avisos.push(
      "Conversa em andamento NÃO sobrevive à publicação: STATE_DIR e STATE_KEY não estão " +
        "definidas, então histórico e lembretes enviados ficam só na memória."
    );
  }

  return { erros, avisos, hospedado: emServidor };
}

/**
 * Imprime o resultado e derruba o processo se houver erro. Derrubar é de
 * propósito: o provedor mostra o log da falha e não troca a versão no ar.
 */
export function exigirAmbienteValido(opcoes) {
  const { erros, avisos, hospedado: emServidor } = conferirAmbiente(opcoes);

  console.log(`Ambiente: ${emServidor ? "SERVIDOR (hospedado)" : "máquina local"}.`);
  for (const aviso of avisos) console.warn(`  aviso: ${aviso}`);

  if (erros.length) {
    console.error("\nO agente NÃO vai subir. Corrija:");
    for (const erro of erros) console.error(`  - ${erro}`);
    console.error("");
    process.exit(1);
  }

  return { erros, avisos, hospedado: emServidor };
}
