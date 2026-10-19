// Roda a suíte inteira:  npm test
//
// Não há lista de testes: todo arquivo `teste-*.mjs` em scripts/ roda. Uma
// lista escrita à mão já deixou teste de fora em silêncio no projeto antigo.
//
// Cada teste roda em processo separado: vários módulos leem o ambiente só ao
// carregar.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/**
 * O que NÃO é teste, com o motivo escrito.
 *
 * Só entra aqui o que precisa de rede ou de chave — ou seja, o que não pode
 * rodar na máquina de quem acabou de clonar o projeto. "Está quebrado" nunca é
 * motivo para entrar nesta lista: teste quebrado se conserta ou se apaga.
 */
const NAO_E_TESTE = {};

/**
 * Nome bonito para a saída. Quem não estiver aqui ganha um nome derivado do
 * arquivo — feio, mas presente, que é o que importa.
 */
const TITULOS = {
  "teste-humanize.mjs": "texto que vai pro WhatsApp",
  "teste-exemplo.mjs": "negócio de exemplo: agenda e ferramentas",
  "teste-tom.mjs": "tom: nada de expressão cafona",
  "teste-custo.mjs": "conta de custo",
  "teste-persistencia.mjs": "estado que sobrevive ao reinício",
  "teste-humano.mjs": "coexistência: liberados e pausa quando o humano responde",
  "teste-ycloud.mjs": "YCloud: assinatura, entrada, envio e mídia",
  "teste-repositorio.mjs": "o que está no disco está no repositório",
};

const titulo = (arquivo) =>
  TITULOS[arquivo] || arquivo.replace(/^teste-/, "").replace(/\.mjs$/, "").replace(/-/g, " ");

const TESTES = readdirSync(AQUI)
  .filter((f) => f.startsWith("teste-") && f.endsWith(".mjs") && !NAO_E_TESTE[f])
  // O de repositório por último: ele confere o conjunto, então faz sentido
  // fechar a conta depois que todo o resto já falou.
  .sort((a, b) => {
    if (a === "teste-repositorio.mjs") return 1;
    if (b === "teste-repositorio.mjs") return -1;
    return titulo(a).localeCompare(titulo(b), "pt-BR");
  })
  .map((arquivo) => [titulo(arquivo), arquivo]);

const env = { ...process.env };

let falharam = 0;

for (const [nome, arquivo] of TESTES) {
  const r = spawnSync(process.execPath, [path.join(AQUI, arquivo)], {
    env,
    encoding: "utf8",
  });

  const linhas = (r.stdout || "").split("\n");
  const oks = linhas.filter((l) => l.startsWith("ok")).length;
  const falhas = linhas.filter((l) => l.startsWith("FALHA"));

  if (r.status === 0 && falhas.length === 0) {
    console.log(`ok    ${nome}  (${oks} verificações)`);
  } else {
    falharam++;
    console.log(`FALHA ${nome}`);
    for (const f of falhas) console.log(`        ${f}`);
    if (r.status !== 0 && falhas.length === 0) {
      console.log((r.stdout || "").trim().split("\n").slice(-6).join("\n"));
      console.log((r.stderr || "").trim().split("\n").slice(-6).join("\n"));
    }
  }
}

const ignorados = Object.keys(NAO_E_TESTE).length;
console.log(
  `\n${TESTES.length} arquivos de teste, ` +
    (falharam ? `${falharam} com falha.` : "tudo passando.") +
    (ignorados ? ` (${ignorados} arquivo fora da suíte de propósito — veja NAO_E_TESTE.)` : "")
);

process.exit(falharam ? 1 : 0);
