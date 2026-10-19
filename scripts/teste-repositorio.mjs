// O que está no disco também está no repositório? Rode da raiz:
//   node scripts/teste-repositorio.mjs
//
// POR QUE ESTE ARQUIVO EXISTE
//
// Em 23/08, o agente subiu no servidor e morreu no arranque com
// "Cannot find module '/app/src/state/intakeStore.js'". O arquivo existia no
// PC, os 182 testes passavam, o `npm start` local funcionava. Ele só não
// estava no repositório: uma linha do .gitignore, `intakes*`, casava com
// `intakeS`tore.js porque o Git no Windows ignora maiúscula e minúscula.
//
// Nenhum teste de comportamento pega isso. O código está certo; o que estava
// errado é o que foi ENVIADO. É uma categoria diferente de erro, e ela só
// aparece na primeira vez que o programa roda numa máquina que não é a sua —
// que é o pior momento possível para descobrir.
//
// Este teste faz duas perguntas que nenhum outro faz:
//
//   1. todo arquivo de código no disco está no repositório?
//   2. todo import relativo aponta para um arquivo que existe?
//
// A segunda é de graça e pega o erro de digitação em caminho, que também só
// apareceria rodando.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarVerificador } from "./verificador.mjs";

const { check, encerrar } = criarVerificador();
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTAS = ["src", "scripts"];

/** Todo arquivo de código dentro das pastas que vão para o servidor. */
function arquivosNoDisco() {
  const achados = [];

  const andar = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const inteiro = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name.startsWith(".")) continue;
        andar(inteiro);
      } else if (/\.(js|mjs)$/.test(item.name)) {
        achados.push(path.relative(RAIZ, inteiro).split(path.sep).join("/"));
      }
    }
  };

  for (const pasta of PASTAS) {
    const inteiro = path.join(RAIZ, pasta);
    if (fs.existsSync(inteiro)) andar(inteiro);
  }
  return achados.sort();
}

/**
 * Quais destes arquivos o .gitignore está engolindo.
 *
 * É a pergunta que separa os dois casos. Arquivo novo que ainda não entrou num
 * commit aparece no `git status` em vermelho e um `git add` resolve — chato,
 * não perigoso. Arquivo ignorado NÃO aparece em lugar nenhum: `git status`
 * cala, `git add -A` não pega, e ele só se manifesta no servidor, no arranque.
 *
 * Este teste existe para cobrir justamente o que o `git status` esconde.
 */
function ignoradosPeloGit(arquivos) {
  if (!arquivos.length) return new Set();

  const ler = (saida) =>
    new Set(String(saida || "").split("\n").map((l) => l.trim()).filter(Boolean));

  try {
    return ler(
      execFileSync("git", ["check-ignore", "--stdin"], {
        cwd: RAIZ,
        encoding: "utf8",
        input: arquivos.join("\n"),
        stdio: ["pipe", "pipe", "ignore"],
      })
    );
  } catch (err) {
    // `git check-ignore` sai com código 1 quando nada casou. Não é erro, é a
    // resposta "nenhum" — e a lista, quando existe, vem no stdout mesmo assim.
    return ler(err?.stdout);
  }
}

/** O que o Git conhece. Null se não houver Git ou repositório. */
function arquivosNoGit() {
  try {
    const saida = execFileSync("git", ["ls-files", ...PASTAS], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(saida.split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Disco contra repositório
// ---------------------------------------------------------------------------

const noDisco = arquivosNoDisco();
check("achei os arquivos de código no disco", noDisco.length > 20);

const noGit = arquivosNoGit();

if (noGit === null) {
  // Rodar fora de um repositório é legítimo (uma cópia baixada, por exemplo).
  // Dizer que pulou é melhor do que passar calado e parecer que verificou.
  console.log("     (sem Git aqui: a comparação com o repositório foi pulada)");
} else {
  const foraDoRepositorio = noDisco.filter((f) => !noGit.has(f));
  const ignorados = ignoradosPeloGit(foraDoRepositorio);
  const semCommit = foraDoRepositorio.filter((f) => !ignorados.has(f));

  for (const f of ignorados) {
    console.log(`     IGNORADO PELO .gitignore: ${f}`);
  }

  check(
    "nenhum arquivo de código está sendo engolido pelo .gitignore",
    ignorados.size === 0
  );

  // Estes não reprovam o teste de propósito: são arquivos novos, normais no
  // meio do trabalho, e o `git status` já grita por eles antes do push. Reprovar
  // aqui faria `npm test` falhar todo dia, e teste que falha sempre é teste que
  // ninguém lê.
  if (semCommit.length) {
    console.log(`     (${semCommit.length} arquivo(s) ainda sem commit — o git status mostra:)`);
    for (const f of semCommit) console.log(`       ${f}`);
  }

  // O contrário também importa, e é mais barato de conferir do que de
  // descobrir: arquivo que o Git conhece mas sumiu do disco quebra o servidor
  // do mesmo jeito, só que ao contrário.
  const sumidos = [...noGit].filter((f) => !fs.existsSync(path.join(RAIZ, f)));
  for (const f of sumidos) console.log(`     NO GIT MAS NÃO NO DISCO: ${f}`);
  check("todo arquivo do repositório existe no disco", sumidos.length === 0);
}

// ---------------------------------------------------------------------------
// 2. Todo import relativo aponta para um arquivo que existe
// ---------------------------------------------------------------------------

const IMPORTA = /(?:^|\n)\s*(?:import[^'"]*?|export[^'"]*?)\bfrom\s*["'](\.[^"']+)["']/g;

const quebrados = [];

for (const arquivo of noDisco) {
  const conteudo = fs.readFileSync(path.join(RAIZ, arquivo), "utf8");
  const pastaDoArquivo = path.dirname(path.join(RAIZ, arquivo));

  for (const m of conteudo.matchAll(IMPORTA)) {
    const destino = path.resolve(pastaDoArquivo, m[1]);
    if (!fs.existsSync(destino)) {
      quebrados.push(`${arquivo} -> ${m[1]}`);
    }
  }
}

for (const q of quebrados) console.log(`     IMPORT QUEBRADO: ${q}`);
check("todo import relativo aponta para um arquivo que existe", quebrados.length === 0);

// ---------------------------------------------------------------------------
// 3. O container chama o node direto, sem npm no meio
//
// Medido em 25/08, e não deduzido: com `npm start`, um SIGTERM no npm NÃO
// chega ao node — o handler de desligamento simplesmente não roda. Com o node
// como processo principal, roda. Era por isso que a linha
// "SIGTERM: encerrando." nunca aparecia no log da Railway, e significava que
// nenhuma publicação passava pela gravação de desligamento.
//
// É uma linha de arquivo de configuração que ninguém releria, e cujo efeito
// (conversa perdida na publicação) aparece longe da causa.
// ---------------------------------------------------------------------------

const dockerfile = path.join(RAIZ, "Dockerfile");

if (!fs.existsSync(dockerfile)) {
  console.log("     (sem Dockerfile aqui: a verificação do CMD foi pulada)");
} else {
  const cmd = fs
    .readFileSync(dockerfile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("CMD"))
    .pop();

  check("o Dockerfile tem um CMD", Boolean(cmd));
  check(
    "o CMD chama o node direto, sem npm (senão o SIGTERM não chega)",
    Boolean(cmd) && cmd.includes('"node"') && !cmd.includes("npm")
  );
}

// E o CMD só vale se ninguém mandar outra coisa por cima. O railway.json tinha
// `deploy.startCommand: "npm start"`, que ganha do Dockerfile — a ponto de o
// campo aparecer TRAVADO no painel, com "The value is set in /railway.json".
// Trocar o CMD sem tirar de lá não muda nada, e foi o que aconteceu em 25/08.
const railway = path.join(RAIZ, "railway.json");

if (fs.existsSync(railway)) {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(railway, "utf8"));
  } catch (err) {
    console.log(`     railway.json ilegível: ${err.message}`);
  }

  check("o railway.json é um JSON válido", config !== null);
  check(
    "o railway.json não sobrescreve o comando de arranque do Dockerfile",
    config !== null && !config.deploy?.startCommand
  );
}

// ---------------------------------------------------------------------------
// TODO NEGÓCIO CARREGA O LIMITE DE SAÚDE
//
// Em 02/09 o agente de temporada ofereceu "uma farmácia perto pra comprar
// pomada ou remédio" para alguém com uma inflamação. A disciplina de saúde
// existia havia uma semana, mas morava dentro do prompt da clínica: o segundo
// negócio nasceu sem nada disso, porque ninguém imaginou hóspede falando de
// sintoma.
//
// Esta verificação é de FONTE, não de execução, de propósito: ela pega o
// negócio número três no dia em que ele for criado, antes de existir teste
// para ele e antes de alguém mandar mensagem. É o tipo de erro que só aparece
// quando já está em produção.
// ---------------------------------------------------------------------------

const LIMITES = path.join(RAIZ, "src", "nucleo", "limites.js");
check("o arquivo de limites compartilhados existe", fs.existsSync(LIMITES));

// Todo negócio é uma pasta em src/ com prompt.js (hoje só o exemplo).
const promptsDeNegocio = [];
for (const entrada of fs.readdirSync(path.join(RAIZ, "src"), { withFileTypes: true })) {
  if (!entrada.isDirectory()) continue;
  const prompt = path.join(RAIZ, "src", entrada.name, "prompt.js");
  if (fs.existsSync(prompt)) promptsDeNegocio.push(prompt);
}

const semLimite = promptsDeNegocio.filter((arquivo) => {
  const texto = fs.readFileSync(arquivo, "utf8");
  return !texto.includes("LIMITE_SAUDE");
});

for (const f of semLimite) console.log(`     PROMPT SEM O LIMITE DE SAÚDE: ${path.relative(RAIZ, f)}`);
check(
  `todo prompt de negócio carrega o limite de saúde (${promptsDeNegocio.length} encontrado(s))`,
  promptsDeNegocio.length >= 1 && semLimite.length === 0
);

encerrar();
