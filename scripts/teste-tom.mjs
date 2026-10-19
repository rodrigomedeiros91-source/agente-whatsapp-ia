// A peneira de tom. Rode da raiz:  node scripts/teste-tom.mjs
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O Rodrigo proibiu expressão cafona em todos os agentes do projeto. A
// barbearia já ensinou que proibir no prompt não basta: "Tanto faz" continuou
// saindo três vezes, com a conversa zerada e a versão certa no ar. O que
// garante é peneirar a saída — e o que impede a volta do problema é um teste
// que varre o prompt de cada negócio procurando o exemplo ruim.
import { peneirarTom, expressoesCafonas } from "../src/nucleo/tom.js";
import { criarVerificador } from "./verificador.mjs";

const { check, encerrar } = criarVerificador();

check(
  "tira a interjeição no começo da frase",
  peneirarTom("Poxa, sinto muito. Consegue pagar dia 20?") === "Consegue pagar dia 20?"
);

check(
  "tira 'Sinto muito' sozinho no começo",
  peneirarTom("Sinto muito pelo ocorrido. Vou registrar aqui.") === "Vou registrar aqui."
);

check(
  "tira 'Que pena' e mantém o resto intacto",
  peneirarTom("Que pena! O boleto vence dia 15.") === "O boleto vence dia 15."
);

check(
  "tira 'Fique tranquilo' depois de um ponto, no meio do texto",
  peneirarTom("Registrei aqui. Fique tranquilo, o Robson vai te chamar. Até mais.") ===
    "Registrei aqui. Até mais."
);

check(
  "não mexe em texto que já está certo",
  peneirarTom("Certo, obrigado por avisar. Tem uma data em que consiga pagar?") ===
    "Certo, obrigado por avisar. Tem uma data em que consiga pagar?"
);

check(
  "não corta frase onde a expressão está no meio",
  peneirarTom("A parcela está em aberto e não se preocupou ninguém até agora.") ===
    "A parcela está em aberto e não se preocupou ninguém até agora."
);

check(
  "não engole o marcador de botões",
  peneirarTom("Poxa, que situação [[opcoes: Sou eu | Número errado]]").includes("[[opcoes:")
);

check("devolve string vazia sem quebrar", peneirarTom("") === "");
check("aguenta null", peneirarTom(null) === "");

check(
  "aponta as três expressões, mesmo as que estão no meio da frase",
  expressoesCafonas("Poxa, que pena. Fique tranquilo.").length === 3
);

check(
  "acha a expressão dentro de um exemplo entre aspas, como está no prompt",
  expressoesCafonas('BOM: "Poxa, sinto muito. Liga na recepção agora."').length === 2
);

check("texto limpo não aponta nada", expressoesCafonas("Bom dia. O boleto venceu ontem.").length === 0);

// "Nossa" e "puxa" também são português normal. Apagar "nossa equipe" ou "o
// prompt puxa mais" seria estragar texto certo — o erro que esta peneira não
// pode cometer. Só a interjeição conta.
check(
  "não confunde possessivo com interjeição",
  expressoesCafonas("Nossa equipe confere todo dia.").length === 0
);
check(
  "não confunde o verbo puxar com interjeição",
  expressoesCafonas("Este bloco é imperativo e por isso ele puxa mais.").length === 0
);
check(
  "mas pega a interjeição de verdade",
  expressoesCafonas("Nossa, que situação. Vou registrar.").length === 1
);
check(
  "e a peneira tira a interjeição sem tocar no possessivo",
  peneirarTom("Nossa, que situação. Nossa equipe confere amanhã.") ===
    "Nossa equipe confere amanhã."
);

// A varredura que impede a volta do problema: o prompt montado do negócio
// não pode ensinar expressão cafona como exemplo de resposta boa.
const { buildSystemPrompt } = await import("../src/exemplo/prompt.js");
const achadas = expressoesCafonas(buildSystemPrompt());
check(
  `o prompt do negócio não ensina expressão cafona (achadas: ${achadas.join(", ") || "nenhuma"})`,
  achadas.length === 0
);

encerrar();
