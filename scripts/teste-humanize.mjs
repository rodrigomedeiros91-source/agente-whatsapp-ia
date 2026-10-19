// Rode da raiz do projeto:  node scripts/teste-humanize.mjs
//
// Este teste roda na sua máquina sem preparo nenhum, porque whatsapp.js não
// importa nada. Os testes da planilha são diferentes: precisam de um Google
// falso e só rodam no ambiente do assistente.
import { humanize } from "../src/nucleo/whatsapp.js";

const casos = [
  [
    "travessão entre espaços vira vírgula",
    "Tenho quinta — dia 21 — às 10h.",
    "Tenho quinta, dia 21, às 10h.",
  ],
  [
    "intervalo de horário vira 'às'",
    "Atendemos das 8h — 18h.",
    "Atendemos das 8h às 18h.",
  ],
  [
    "negrito em markdown some",
    "Sua consulta é **quinta-feira** às 10h.",
    "Sua consulta é quinta-feira às 10h.",
  ],
  [
    "marcador de lista some",
    "Tenho estes horários:\n- 10h\n- 11h\n- 14h",
    "Tenho estes horários:\n10h\n11h\n14h",
  ],
  [
    "meia-risca também",
    "Dr. Paulo – clínico geral",
    "Dr. Paulo, clínico geral",
  ],
  [
    "texto limpo passa intacto",
    "Pronto, marquei com o Dr. Paulo na quinta, dia 21, às 10h.",
    "Pronto, marquei com o Dr. Paulo na quinta, dia 21, às 10h.",
  ],
  [
    "hífen comum não é tocado",
    "É pré-agendamento, não é auto-atendimento.",
    "É pré-agendamento, não é auto-atendimento.",
  ],
  [
    "número de telefone com hífen sobrevive",
    "Ligue para (11) 90000-0001.",
    "Ligue para (11) 90000-0001.",
  ],
  [
    "vírgula duplicada não sobra",
    "Quinta, — dia 21.",
    "Quinta, dia 21.",
  ],
  [
    "vazio e nulo não quebram",
    "",
    "",
  ],
];

let falhas = 0;
for (const [nome, entrada, esperado] of casos) {
  const saida = humanize(entrada);
  if (saida === esperado) {
    console.log(`ok   ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA ${nome}\n     esperado: ${JSON.stringify(esperado)}\n     obtido:   ${JSON.stringify(saida)}`);
  }
}

// Não pode explodir com entrada inesperada.
for (const estranho of [null, undefined, 0, false]) {
  try {
    humanize(estranho);
  } catch (err) {
    falhas++;
    console.log(`FALHA humanize(${JSON.stringify(estranho)}) explodiu: ${err.message}`);
  }
}


// --- tipos de mensagem que não merecem resposta -----------------------------
const { parseIncomingMessage, __registrarEnviada } = await import("../src/nucleo/whatsapp.js");

const envelope = (type, extra = {}) => ({
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: "Rodrigo" } }],
    messages: [{ id: "wamid.1", from: "5511900000001", type, ...extra }],
  } }] }],
});

const casosTipo = [
  ["reação é ignorada em silêncio", envelope("reaction", { reaction: { emoji: "👍" } }), null],
  ["aviso de sistema é ignorado", envelope("system", {}), null],
  ["texto continua sendo processado", envelope("text", { text: { body: "oi" } }), "text"],
  ["áudio continua tendo tratamento", envelope("audio", { audio: { id: "1" } }), "audio"],
  ["figurinha ainda recebe resposta", envelope("sticker", {}), "unsupported"],
];

let extras = 0;
for (const [nome, body, esperado] of casosTipo) {
  const r = parseIncomingMessage(body);
  const obtido = r === null ? null : r.kind;
  if (obtido === esperado) {
    console.log(`ok   ${nome}`);
  } else {
    extras++;
    console.log(`FALHA ${nome}: esperado ${esperado}, obtido ${obtido}`);
  }
}

// --- reação como resposta ---------------------------------------------------
const TEL = "5511900000001";
const reacao = (emoji, alvo) => envelope("reaction", { reaction: { emoji, message_id: alvo } });

const casosReacao = [
  // Confirmações: o modelo inventa a frase, então nenhuma delas está em lista.
  ["\"Fechado?\" vira sim", "Tenho 15h livre na segunda, dia 24, com o Dr. Paulo. Fechado?", "👍", "m1", "sim"],
  ["\"Combinado?\" vira sim", "Marco pra quinta às 10h. Combinado?", "👍", "m1", "sim"],
  ["\"Posso marcar?\" vira sim", "Posso marcar?", "👍", "m1", "sim"],
  ["\"Beleza?\" vira sim", "Fica pra terça então. Beleza?", "👍", "m1", "sim"],
  ["\"Tudo certo?\" vira sim", "Tudo certo?", "👍", "m1", "sim"],
  // Perguntas onde o joinha não responde nada.
  ["pergunta aberta com QUAL é ignorada", "Qual dia da semana que vem fica melhor pra você?", "👍", "m1", null],
  ["pergunta aberta com COMO é ignorada", "Boa noite, Rodrigo! Como posso ajudar?", "👍", "m1", null],
  ["pergunta de escolha com OU é ignorada", "É primeira consulta, retorno, pré-natal ou veio por encaminhamento?", "👍", "m1", null],
  ["pedido de dado é ignorado", "Só falta seu CPF, pode me passar?", "👍", "m1", null],
  ["a última pergunta é a que vale", "O Dr. Paulo atende segunda e quarta. Fechado?", "👍", "m1", "sim"],
  ["joinha na pergunta de confirmação vira sim", "Confere tudo certinho?", "👍", "m1", "sim"],
  ["coração também confirma", "Confere tudo certinho?", "❤️", "m1", "sim"],
  ["joinha com tom de pele conta igual", "Confere tudo certinho?", "👍🏽", "m1", "sim"],
  ["polegar pra baixo vira não", "Está correto?", "👎", "m1", "não"],
  ["joinha no encerramento é ignorado", "Prontinho, dados salvos.", "👍", "m1", null],
  ["joinha em pergunta aberta é ignorado", "Qual seu nome completo?", "👍", "m1", null],
  ["reação em mensagem antiga é ignorada", "Confere tudo certinho?", "👍", "m-antiga", null],
  ["emoji ambíguo é ignorado", "Confere tudo certinho?", "😂", "m1", null],
  ["reação removida é ignorada", "Confere tudo certinho?", "", "m1", null],
];

for (const [nome, ultimaMsg, emoji, alvo, esperado] of casosReacao) {
  __registrarEnviada(TEL, "m1", ultimaMsg);
  const r = parseIncomingMessage(reacao(emoji, alvo));
  const obtido = r === null ? null : r.text;
  if (obtido === esperado) {
    console.log(`ok   ${nome}`);
  } else {
    extras++;
    console.log(`FALHA ${nome}: esperado ${esperado}, obtido ${obtido}`);
  }
}



// --- botões de resposta -----------------------------------------------------
const { extrairOpcoes, montarPayload } = await import("../src/nucleo/whatsapp.js");

function checar(nome, cond) {
  if (cond) { console.log("ok   " + nome); } else { extras++; console.log("FALHA " + nome); }
}

const semMarcador = extrairOpcoes("Qual seu nome completo?");
checar("texto sem marcador passa intacto", semMarcador.texto === "Qual seu nome completo?" && semMarcador.opcoes.length === 0);

const tresOpcoes = extrairOpcoes("Qual turno fica melhor? [[opcoes: Manhã | Tarde | Noite]]");
checar("marcador é removido do texto", tresOpcoes.texto === "Qual turno fica melhor?");
checar("as três opções são extraídas", tresOpcoes.opcoes.join(",") === "Manhã,Tarde,Noite");
checar("marcador com cedilha e til também casa", extrairOpcoes("A? [[opções: X | Y]]").opcoes.length === 2);

const pButton = montarPayload("5521", "Qual turno?", ["Manhã", "Tarde", "Noite"]);
checar("3 opções viram botões", pButton.type === "interactive" && pButton.interactive.type === "button");
checar("os 3 botões têm id único", new Set(pButton.interactive.action.buttons.map(b => b.reply.id)).size === 3);

const pLista = montarPayload("5521", "Escolha o horário", ["08:00","09:00","10:00","11:00","14:00"]);
checar("de 4 a 10 opções viram lista", pLista.interactive.type === "list");
checar("a lista tem as 5 linhas", pLista.interactive.action.sections[0].rows.length === 5);

const pTexto = montarPayload("5521", "Qual seu nome?", []);
checar("sem opções continua texto simples", pTexto.type === "text");

const demais = montarPayload("5521", "Muitos horários", Array.from({length: 14}, (_, i) => "h" + i));
checar("mais de 10 opções voltam a ser texto, sem cortar nenhuma", demais.type === "text");

const longo = montarPayload("5521", "?", ["Primeira consulta de acompanhamento anual"]);
checar("título longo é cortado em 20 caracteres", longo.interactive.action.buttons[0].reply.title.length <= 20);

const semCorpo = montarPayload("5521", "", ["Sim", "Não"]);
checar("corpo vazio ganha texto padrão, senão a API recusa", semCorpo.interactive.body.text.length > 0);

// ---------------------------------------------------------------------------
// O "unsupported" que vem da PRÓPRIA META
//
// 04/09, 09:00:36. A primeira mensagem que a Bruna mandou para o agente caiu
// aqui, e o log guardou só isto:
//
//   Unsupported message type "unsupported" from 5511999910621
//
// Não dá para saber o que ela tentou mandar. Enquete? Visualização única? Um
// áudio num formato que a Cloud API não repassa? A Meta manda o motivo junto,
// em `errors`, e a gente estava jogando fora — na conversa da primeira cliente
// em potencial do projeto.
//
// "unsupported" não é figurinha nem áudio: é a plataforma dizendo que o
// conteúdo não veio. Merece resposta própria, que não culpe a pessoa nem peça
// que ela mude de hábito.
// ---------------------------------------------------------------------------
{
  const { unsupportedReplyFor } = await import("../src/nucleo/whatsapp.js");

  const comErro = parseIncomingMessage(
    envelope("unsupported", { errors: [{ code: 131051, title: "Unsupported message type" }] })
  );
  checar("o motivo que a Meta manda é guardado", comErro?.motivo === "131051 Unsupported message type");

  const semErro = parseIncomingMessage(envelope("unsupported", {}));
  checar("sem motivo informado, não quebra", semErro?.kind === "unsupported" && semErro.motivo === null);

  const resposta = unsupportedReplyFor("unsupported");
  checar("o tipo unsupported tem resposta própria, não a genérica", /n[ãa]o chegou aqui/i.test(resposta));
  checar("a resposta não culpa a pessoa nem manda mudar de hábito", !/n[ãa]o consigo processar/i.test(resposta));

  // A figurinha continua com a resposta dela: são coisas diferentes e a
  // correção de uma não pode apagar a outra.
  checar("figurinha continua com a resposta própria", /figurinha/i.test(unsupportedReplyFor("sticker")));
}

console.log(falhas + extras === 0 ? "\ntodos os casos passaram" : `\n${falhas + extras} falha(s)`);
process.exit(falhas + extras === 0 ? 0 : 1);
