/**
 * Estado que sobrevive a um reinício.
 *
 * O problema: sessionStore e intakeStore são Map na memória. No PC isso só
 * incomodava quando o Rodrigo reiniciava. Hospedado, toda publicação de versão
 * derruba conversa em andamento e ficha pela metade — e quem já digitou CPF e
 * carteirinha uma vez não digita de novo: liga ou desiste.
 *
 * A parte delicada: gravar isso em disco significa CPF, carteirinha e data de
 * nascimento parados num arquivo. Sob a LGPD, dado de saúde em repouso pede
 * cifragem. Então este módulo grava cifrado (AES-256-GCM) ou não grava.
 *
 * REGRA DE OURO: sem STATE_DIR e STATE_KEY, tudo aqui vira no-op e o
 * comportamento é exatamente o de antes — memória pura. Nunca grava dado de
 * paciente em texto puro, nem por engano, nem por variável mal preenchida.
 *
 * A chave se gera assim, e vai para a variável STATE_KEY do provedor:
 *   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DIR = (process.env.STATE_DIR || "").trim();
const CHAVE_CRUA = (process.env.STATE_KEY || "").trim();

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

function derivarChave(bruta) {
  // 64 hex = 32 bytes: chave de verdade, usada como está.
  if (/^[0-9a-f]{64}$/i.test(bruta)) return Buffer.from(bruta, "hex");

  // Qualquer outra coisa é senha digitada por gente. scrypt encarece a
  // tentativa e erro de quem pegar o arquivo, mas o certo é a chave de 64.
  return crypto.scryptSync(bruta, "whatsapp-ai-agent/estado", 32);
}

const CHAVE = CHAVE_CRUA ? derivarChave(CHAVE_CRUA) : null;
export const ATIVA = Boolean(DIR && CHAVE);

/** Motivo de estar desligada, para o log do arranque dizer algo útil. */
export function porqueDesligada() {
  if (ATIVA) return null;
  if (!DIR && !CHAVE_CRUA) return "STATE_DIR e STATE_KEY não definidas";
  if (!DIR) return "STATE_DIR não definida";
  return "STATE_KEY não definida";
}

function cifrar(texto) {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, CHAVE, iv);
  const corpo = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), corpo]);
}

function decifrar(buffer) {
  const iv = buffer.subarray(0, TAMANHO_IV);
  const tag = buffer.subarray(TAMANHO_IV, TAMANHO_IV + TAMANHO_TAG);
  const corpo = buffer.subarray(TAMANHO_IV + TAMANHO_TAG);

  const decipher = crypto.createDecipheriv(ALGORITMO, CHAVE, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(corpo), decipher.final()]).toString("utf8");
}

const registrados = new Set();

/**
 * Um arquivo de estado. Devolve sempre a mesma interface, ativa ou não, para
 * quem chama não precisar saber de nada disso.
 *
 * @param {string} nome  vira "<nome>.enc" dentro de STATE_DIR
 * @param {string[]} mapas  nomes das coleções guardadas no mesmo arquivo
 */
export function arquivoDeEstado(nome, mapas) {
  const caminho = DIR ? path.join(DIR, `${nome}.enc`) : null;
  let timer = null;
  let vivos = null;

  const instancia = {
    ativa: ATIVA,
    caminho,

    /**
     * Lê o que estava gravado. Devolve um objeto com um Map por nome pedido,
     * sempre — se não houver arquivo, se estiver corrompido ou se a chave
     * estiver errada, devolve Maps vazios e a vida segue.
     *
     * Cair de volta para vazio é de propósito: estado perdido é ruim, agente
     * que não sobe é pior.
     */
    carregar() {
      const vazio = Object.fromEntries(mapas.map((m) => [m, new Map()]));
      if (!ATIVA) return vazio;

      try {
        const cru = fs.readFileSync(caminho);
        const dados = JSON.parse(decifrar(cru));
        for (const m of mapas) {
          if (Array.isArray(dados[m])) vazio[m] = new Map(dados[m]);
        }
        const total = mapas.reduce((soma, m) => soma + vazio[m].size, 0);
        if (total) console.log(`Estado recuperado de ${nome}.enc: ${total} registro(s).`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.warn(`Não consegui ler ${nome}.enc (${err.message}). Começando vazio.`);
        }
      }
      return vazio;
    },

    /** Guarda a referência viva das coleções e agenda a gravação. */
    registrar(colecoes) {
      vivos = colecoes;
      if (ATIVA) registrados.add(instancia);
      return colecoes;
    },

    /**
     * Gravação adiada.
     *
     * Uma conversa gera várias escritas por minuto e o arquivo é pequeno;
     * gravar a cada uma seria disco à toa. Um segundo de atraso junta tudo.
     * O timer é unref: não segura o processo de encerrar.
     */
    salvar() {
      if (!ATIVA || !vivos) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        instancia.salvarAgora();
      }, 1000);
      timer.unref?.();
    },

    /** Gravação imediata. Usada no desligamento, quando não há um segundo. */
    salvarAgora() {
      if (!ATIVA || !vivos) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      try {
        fs.mkdirSync(DIR, { recursive: true });
        const dados = Object.fromEntries(mapas.map((m) => [m, [...(vivos[m] || new Map())]]));

        // Escreve ao lado e renomeia: se o processo morrer no meio, o arquivo
        // bom continua lá. Arquivo pela metade não decifra, e aí o estado
        // inteiro se perderia por causa de uma gravação interrompida.
        const temporario = `${caminho}.tmp`;
        fs.writeFileSync(temporario, cifrar(JSON.stringify(dados)));
        fs.renameSync(temporario, caminho);
      } catch (err) {
        console.warn(`Não consegui gravar ${nome}.enc: ${err.message}`);
      }
    },
  };

  return instancia;
}

/**
 * Grava tudo agora. O provedor manda SIGTERM e dá alguns segundos antes de
 * matar o processo; é essa janela que salva a conversa de quem estava no meio
 * de um cadastro na hora da publicação.
 */
export function gravarTudoAgora() {
  for (const instancia of registrados) instancia.salvarAgora();
  return registrados.size;
}

/**
 * Liga a gravação ao desligamento do processo.
 *
 * Publicar versão nova é isto: o provedor manda SIGTERM, espera alguns
 * segundos e mata. Sem passar por aqui, a gravação adiada de um segundo nunca
 * acontece, e quem estava no meio do cadastro recomeça do zero. Ctrl+C no PC
 * manda SIGINT e cai no mesmo caminho.
 *
 * Fica neste arquivo, e não no server.js, para o teste conseguir exercitar o
 * caminho de verdade em vez de uma imitação dele.
 */
export function instalarGravacaoNoDesligamento({ aoEncerrar } = {}) {
  let desligando = false;

  const tratar = (sinal) => {
    if (desligando) return;
    desligando = true;

    const arquivos = gravarTudoAgora();
    console.log(
      `${sinal}: encerrando.` + (arquivos ? ` Estado gravado em ${arquivos} arquivo(s).` : "")
    );

    aoEncerrar?.();

    // Se alguma conexão pendurar, não dá para ficar esperando: o provedor mata
    // o processo de qualquer jeito. O estado já está gravado, que é o que
    // importa.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGTERM", () => tratar("SIGTERM"));
  process.on("SIGINT", () => tratar("SIGINT"));
}
