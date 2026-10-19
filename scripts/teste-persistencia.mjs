// Estado que sobrevive ao reinício. Rode da raiz:
//   node scripts/teste-persistencia.mjs
//
// Duas coisas precisam ser verdade ao mesmo tempo, e são elas que este teste
// defende:
//
//   1. a conversa e a ficha voltam depois de um reinício;
//   2. o CPF NUNCA está legível no arquivo.
//
// A segunda é a que importa mais. Se a cifragem quebrar, tudo continua
// funcionando perfeitamente e ninguém percebe, até o dia em que alguém abre o
// arquivo. Por isso aqui a gente procura o CPF dentro dos bytes gravados.
//
// O módulo lê STATE_DIR e STATE_KEY no carregamento, então os casos que mudam
// o ambiente rodam em processo separado, chamando este mesmo arquivo.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarVerificador } from "./verificador.mjs";

const ESTE_ARQUIVO = fileURLToPath(import.meta.url);
const MODO = process.env.TESTE_PERSISTENCIA_MODO || "principal";

const CPF = "529.982.247-25"; // CPF válido de exemplo, não é de ninguém
const CHAVE = "a".repeat(64);
const OUTRA_CHAVE = "b".repeat(64);

function fichaDeExemplo() {
  return new Map([
    ["5521999990000", { reference: "INT-ABC123", cpf: CPF, savedAt: Date.now() }],
  ]);
}

/** Roda este mesmo arquivo noutro processo, com outro ambiente. */
function noutroProcesso(modo, extra) {
  const env = { ...process.env, TESTE_PERSISTENCIA_MODO: modo, ...extra };
  for (const [chave, valor] of Object.entries(extra)) {
    if (valor === undefined) delete env[chave];
  }
  const r = spawnSync(process.execPath, [ESTE_ARQUIVO], { env, encoding: "utf8" });
  return (r.stdout || "").trim();
}

// ---------------------------------------------------------------------------
// Modos filhos: imprimem uma linha e saem.
// ---------------------------------------------------------------------------

if (MODO === "chave-errada") {
  const { arquivoDeEstado } = await import("../src/nucleo/persistencia.js");
  const { intakes } = arquivoDeEstado("fichas", ["intakes"]).carregar();
  console.log(`REGISTROS:${intakes.size}`);
  process.exit(0);
}

if (MODO === "sem-chave") {
  const { arquivoDeEstado, ATIVA } = await import("../src/nucleo/persistencia.js");
  const disco = arquivoDeEstado("fichas", ["intakes"]);
  disco.registrar({ intakes: fichaDeExemplo() });
  disco.salvarAgora();
  console.log(`ATIVA:${ATIVA}`);
  process.exit(0);
}

// Os dois modos abaixo são o par que mede a única coisa que importa na hora
// da publicação: a conversa foi gravada antes de o processo morrer?
//
// "sem-desligamento" é o controle. Ele salva e sai na hora, sem passar pelo
// desligamento, e o arquivo NÃO pode existir — é o comportamento de antes.
if (MODO === "sem-desligamento") {
  const { saveHistory } = await import("../src/nucleo/sessionStore.js");
  saveHistory("5521999990000", [{ role: "user", content: "quero marcar" }]);
  process.exit(0);
}

if (MODO === "com-desligamento") {
  const { saveHistory } = await import("../src/nucleo/sessionStore.js");
  const { instalarGravacaoNoDesligamento } = await import("../src/nucleo/persistencia.js");

  instalarGravacaoNoDesligamento();
  saveHistory("5521999990000", [{ role: "user", content: "quero marcar" }]);

  // Como fingir a publicação de versão nova, e por que muda por sistema.
  //
  // No Linux — que é onde o servidor roda — process.kill no próprio processo
  // entrega um SIGTERM de verdade, e o handler roda. É o caminho real, medido
  // de ponta a ponta.
  //
  // No WINDOWS não existe sinal POSIX. process.kill(self, "SIGTERM") não
  // entrega nada: encerra o processo na hora, e o handler nunca roda. O teste
  // falhava na máquina do Rodrigo por causa disso, com o código correto — e o
  // "SIGINT: encerrando." que aparece quando ele dá Ctrl+C no npm start é a
  // prova de que o desligamento funciona lá.
  //
  // Então no Windows a gente dispara o evento direto. Mede a nossa parte (o
  // handler grava antes de morrer) sem medir a entrega do sinal, que é
  // trabalho do sistema operacional e não nosso.
  //
  // TESTE_SINAL força um dos dois caminhos, para dar para conferir os dois na
  // mesma máquina.
  const modo = process.env.TESTE_SINAL || (process.platform === "win32" ? "emit" : "kill");

  // O pai lê esta linha para dizer, no resultado, qual dos dois foi medido.
  console.log(`MODO_SINAL:${modo}`);

  if (modo === "emit") process.emit("SIGTERM");
  else process.kill(process.pid, "SIGTERM");

  // Sem esta espera o processo sairia antes de o sinal ser tratado.
  await new Promise((pronto) => setTimeout(pronto, 300));
  process.exit(0);
}

// O par que mede a trava contra reenvio da Meta atravessando uma publicação.
if (MODO === "marcar-id") {
  const { alreadyProcessed } = await import("../src/nucleo/sessionStore.js");
  const { gravarTudoAgora } = await import("../src/nucleo/persistencia.js");

  const primeira = alreadyProcessed("wamid.TESTE1");
  gravarTudoAgora();
  console.log(`PRIMEIRA:${primeira}`);
  process.exit(0);
}

if (MODO === "conferir-id") {
  const { alreadyProcessed } = await import("../src/nucleo/sessionStore.js");
  console.log(`REPETIDA:${alreadyProcessed("wamid.TESTE1")}`);
  process.exit(0);
}

if (MODO === "ler-conversa") {
  const { getHistory } = await import("../src/nucleo/sessionStore.js");
  const h = getHistory("5521999990000");
  console.log(`CONVERSA:${h.length}:${h[0]?.content || ""}`);
  process.exit(0);
}

if (MODO === "recuperar") {
  const { arquivoDeEstado } = await import("../src/nucleo/persistencia.js");
  const { intakes } = arquivoDeEstado("fichas", ["intakes"]).carregar();
  const ficha = intakes.get("5521999990000");
  console.log(`RECUPERADO:${intakes.size}:${ficha?.cpf || ""}:${ficha?.reference || ""}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Processo principal
// ---------------------------------------------------------------------------

const { check, encerrar } = criarVerificador();
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), "teste-estado-"));

process.env.STATE_DIR = PASTA;
process.env.STATE_KEY = CHAVE;

const { arquivoDeEstado, ATIVA, gravarTudoAgora } = await import("../src/nucleo/persistencia.js");

check("com STATE_DIR e STATE_KEY, a gravação fica ativa", ATIVA === true);

const disco = arquivoDeEstado("fichas", ["intakes"]);
disco.registrar({ intakes: fichaDeExemplo() });
disco.salvarAgora();

const arquivo = path.join(PASTA, "fichas.enc");
check("o arquivo foi criado", fs.existsSync(arquivo));

// O coração do teste.
const bytes = fs.readFileSync(arquivo);
const comoTexto = bytes.toString("latin1");
check("o CPF NÃO aparece no arquivo", !comoTexto.includes("529.982.247-25"));
check("o CPF sem pontuação também não aparece", !comoTexto.includes("52998224725"));
check("a referência da ficha não aparece", !comoTexto.includes("INT-ABC123"));
check("o nome do campo 'cpf' não aparece", !comoTexto.includes('"cpf"'));

// Reinício de verdade: outro processo, mesma chave.
const recuperado = noutroProcesso("recuperar", { STATE_DIR: PASTA, STATE_KEY: CHAVE });
const linha = recuperado.split("\n").pop();
check("depois de reiniciar, a ficha volta", linha === `RECUPERADO:1:${CPF}:INT-ABC123`);

// Chave trocada não pode derrubar o agente: volta vazio e a vida segue.
const comOutraChave = noutroProcesso("chave-errada", { STATE_DIR: PASTA, STATE_KEY: OUTRA_CHAVE });
check("com a chave errada, começa vazio em vez de quebrar", comOutraChave.endsWith("REGISTROS:0"));

// Arquivo corrompido, mesma exigência.
fs.writeFileSync(arquivo, Buffer.from("isto não é um arquivo cifrado"));
const corrompido = noutroProcesso("recuperar", { STATE_DIR: PASTA, STATE_KEY: CHAVE });
check(
  "arquivo corrompido não derruba o arranque",
  corrompido.split("\n").pop() === "RECUPERADO:0::"
);

// Sem chave, NADA vai para o disco. Esta é a garantia que permite deixar o
// código ligado no PC do Rodrigo sem gravar dado de paciente em texto puro.
const pastaLimpa = fs.mkdtempSync(path.join(os.tmpdir(), "teste-estado-"));
const semChave = noutroProcesso("sem-chave", { STATE_DIR: pastaLimpa, STATE_KEY: undefined });
check("sem STATE_KEY, a gravação fica desligada", semChave.endsWith("ATIVA:false"));
check("sem STATE_KEY, nenhum arquivo é criado", fs.readdirSync(pastaLimpa).length === 0);

// A gravação de desligamento alcança quem se registrou.
check("gravarTudoAgora encontra o arquivo registrado", gravarTudoAgora() === 1);

// --- publicação de versão nova, que é o caso que motivou tudo isto ---------
//
// A gravação é adiada em um segundo para não bater no disco a cada mensagem.
// Numa publicação, o processo morre antes desse segundo. Estes dois casos
// medem justamente essa janela.

const semDesligamento = fs.mkdtempSync(path.join(os.tmpdir(), "teste-estado-"));
noutroProcesso("sem-desligamento", { STATE_DIR: semDesligamento, STATE_KEY: CHAVE });
check(
  "sem tratar o desligamento, a conversa se perde (é o comportamento antigo)",
  !fs.existsSync(path.join(semDesligamento, "conversas.enc"))
);

const comDesligamento = fs.mkdtempSync(path.join(os.tmpdir(), "teste-estado-"));
const saidaDesligamento = noutroProcesso("com-desligamento", {
  STATE_DIR: comDesligamento,
  STATE_KEY: CHAVE,
});
check(
  "com SIGTERM tratado, a conversa é gravada antes de morrer",
  fs.existsSync(path.join(comDesligamento, "conversas.enc"))
);

// Qual dos dois caminhos foi medido, lido do próprio filho e não deduzido do
// sistema. A primeira versão desta linha olhava process.platform e dizia
// "sinal de verdade" mesmo quando TESTE_SINAL tinha forçado o contrário —
// um teste que mente sobre o que mediu é pior do que teste nenhum.
const usou = saidaDesligamento.includes("MODO_SINAL:emit") ? "emit" : "kill";
console.log(
  usou === "emit"
    ? "     (evento disparado direto: no Windows não há sinal POSIX para entregar)"
    : "     (sinal do sistema operacional de verdade)"
);

const depoisDoDeploy = noutroProcesso("ler-conversa", {
  STATE_DIR: comDesligamento,
  STATE_KEY: CHAVE,
});
check(
  "a versão nova sobe e a paciente continua de onde parou",
  depoisDoDeploy.split("\n").pop() === "CONVERSA:1:quero marcar"
);

// --- o webhook reenviado depois da publicação ------------------------------
//
// Em 25/08 o agente mandou "Como posso te ajudar, Rodrigo?" sozinho, mais de
// uma hora depois da última mensagem dele, em cima de um reinício. A lista de
// mensagens já respondidas vivia só na memória: o reinício apagava a lista, o
// reenvio da Meta chegava e era tratado como mensagem nova.
//
// Estes dois casos são o antes e o depois desse dia.

const pastaIds = fs.mkdtempSync(path.join(os.tmpdir(), "teste-estado-"));

const primeiraVez = noutroProcesso("marcar-id", { STATE_DIR: pastaIds, STATE_KEY: CHAVE });
check("a primeira vez que um webhook chega, ele é processado", primeiraVez.endsWith("PRIMEIRA:false"));

const depoisDeReiniciar = noutroProcesso("conferir-id", { STATE_DIR: pastaIds, STATE_KEY: CHAVE });
check(
  "depois de publicar versão nova, o reenvio da Meta NÃO vira resposta repetida",
  depoisDeReiniciar.endsWith("REPETIDA:true")
);

fs.rmSync(pastaIds, { recursive: true, force: true });

fs.rmSync(semDesligamento, { recursive: true, force: true });
fs.rmSync(comDesligamento, { recursive: true, force: true });

fs.rmSync(PASTA, { recursive: true, force: true });
fs.rmSync(pastaLimpa, { recursive: true, force: true });

encerrar();
