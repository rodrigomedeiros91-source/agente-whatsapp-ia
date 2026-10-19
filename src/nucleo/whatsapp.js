import { peneirarTom } from "./tom.js";
import { usaYCloud, YCLOUD_API, cabecalhosYCloud, e164 } from "./ycloud.js";

const GRAPH_URL = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/**
 * Manda uma mensagem pela Meta ou pela YCloud (ver services/ycloud.js).
 *
 * Na YCloud o corpo é o mesmo da Meta, sem `messaging_product` e com `from`.
 * `sendDirectly`, e não a fila: a resposta já traz o wamid, que é o que a
 * reação do cliente cita (ver lerReacao).
 */
function postar(corpo) {
  if (!usaYCloud()) {
    return fetch(GRAPH_URL, { method: "POST", headers: authHeaders(), body: JSON.stringify(corpo) });
  }
  const { messaging_product, ...resto } = corpo;
  return fetch(`${YCLOUD_API}/whatsapp/messages/sendDirectly`, {
    method: "POST",
    headers: cabecalhosYCloud(),
    body: JSON.stringify({ ...resto, from: e164(process.env.YCLOUD_NUMERO), to: e164(corpo.to) }),
  });
}

/** Id da mensagem enviada: a Meta devolve em `messages[0].id`, a YCloud em `wamid`. */
const idEnviado = (dados) => dados?.messages?.[0]?.id || dados?.wamid || null;

/**
 * Última peneira antes de a mensagem virar bolha no celular do paciente.
 *
 * O prompt já manda escrever como gente, mas instrução é probabilística: uma
 * vez a cada tantas respostas o modelo escorrega e solta um travessão ou um
 * negrito em markdown. Travessão em conversa de WhatsApp entrega na hora que
 * do outro lado tem uma máquina, e foi assim que um amigo do Rodrigo percebeu
 * em 20/08, logo na primeira mensagem de teste.
 *
 * Aqui a correção é determinística: não depende de o modelo colaborar.
 *
 * Cuidado ao mexer: roda em TODA mensagem enviada, inclusive nas respostas
 * fixas de áudio e imagem. Regra errada aqui estraga o texto de todo mundo,
 * então cada uma abaixo é conservadora de propósito.
 */
export function humanize(text) {
  if (!text) return text;

  return (
    String(text)
      // Entre números é intervalo: "8h — 18h" vira "8h às 18h". Precisa vir
      // ANTES da regra geral, senão vira "8h, 18h" e o paciente lê como duas
      // opções de horário em vez de uma faixa de atendimento.
      .replace(/(\d\s*h?)\s*[—–]\s*(\d)/g, "$1 às $2")
      // Travessão entre espaços vira vírgula, que é o que uma pessoa digitaria.
      .replace(/\s+[—–]\s+/g, ", ")
      // Sobrou algum solto.
      .replace(/[—–]/g, ",")
      // Markdown. O WhatsApp usa um asterisco só para negrito, mas secretária
      // nenhuma formata texto: some com tudo.
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      // Marcador de lista no começo da linha.
      .replace(/^[ \t]*[-*•]\s+/gm, "")
      // Resíduos das trocas acima.
      .replace(/,\s*,+/g, ",")
      .replace(/[ \t]+([,.!?;:])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Última mensagem que o agente enviou para cada contato.
 *
 * Guardada para dar sentido às reações: um joinha só significa "pode seguir"
 * se estiver colado na pergunta que o agente acabou de fazer. Colado numa
 * mensagem antiga, ou no "prontinho, dados salvos", não significa nada.
 *
 * Vive em memória e some no reinício, igual ao histórico da conversa. O pior
 * que acontece é uma reação perdida logo após um restart.
 */
const ultimaEnviada = new Map();
const VALIDADE_MS = 2 * 60 * 60 * 1000;

function guardarEnviada(para, id, texto) {
  if (!id) return;
  ultimaEnviada.set(String(para), { id, texto, em: Date.now() });

  // Faxina barata, para o Map não crescer para sempre num servidor que fica
  // meses no ar.
  if (ultimaEnviada.size > 500) {
    const limite = Date.now() - VALIDADE_MS;
    for (const [k, v] of ultimaEnviada) if (v.em < limite) ultimaEnviada.delete(k);
  }
}

/**
 * Botões de resposta rápida.
 *
 * O modelo termina a mensagem com um marcador:
 *
 *   Qual turno fica melhor? [[opcoes: Manhã | Tarde | Noite]]
 *
 * O marcador sai do texto e vira botão de verdade no WhatsApp. Quando o
 * paciente toca, o título do botão volta como se ele tivesse digitado, e o
 * resto do agente não muda nada.
 *
 * Por que vale: tocar é mais fácil que digitar, e a pesquisa de campo mostrou
 * que o público das clínicas é mais velho. É a mesma razão da transcrição de
 * áudio: tirar o teclado do caminho.
 *
 * Limites da API: 3 botões, título de 20 caracteres (o teto é 25, mas acima
 * de 20 corta em tela pequena). De 4 a 10 opções vira lista. Acima de 10 não
 * cabe, e aí volta a ser texto puro em vez de sumir com opção sem avisar.
 */
const MARCADOR_OPCOES = /\[\[\s*op[çc][õo]es\s*:\s*([^\]]+)\]\]/i;

const MAX_BOTOES = 3;
const MAX_LISTA = 10;
const MAX_TITULO = 20;
const MAX_CORPO = 1024;

const corta = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

/** Separa o texto das opções. Sem marcador, devolve o texto intacto. */
export function extrairOpcoes(texto) {
  const bruto = String(texto || "");
  const m = bruto.match(MARCADOR_OPCOES);
  if (!m) return { texto: bruto, opcoes: [] };

  const opcoes = m[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  return { texto: bruto.replace(MARCADOR_OPCOES, "").trim(), opcoes };
}

/** Monta o corpo do POST: texto simples, botões ou lista, conforme a quantidade. */
export function montarPayload(to, corpo, opcoes = []) {
  const base = { messaging_product: "whatsapp", to };

  // Sem opções, ou opções demais para caber em lista: texto puro. Cortar
  // silenciosamente a 11ª opção seria pior que não usar botão nenhum.
  if (!opcoes.length || opcoes.length > MAX_LISTA) {
    return { ...base, type: "text", text: { body: corta(corpo, MAX_CORPO) } };
  }

  // O corpo não pode ir vazio: se o modelo mandar só o marcador, a API recusa.
  const texto = corta(corpo || "Escolha uma opção:", MAX_CORPO);

  if (opcoes.length <= MAX_BOTOES) {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: texto },
        action: {
          buttons: opcoes.map((titulo, i) => ({
            type: "reply",
            reply: { id: `opt_${i}`, title: corta(titulo, MAX_TITULO) },
          })),
        },
      },
    };
  }

  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: texto },
      action: {
        button: "Ver opções",
        sections: [
          {
            title: "Opções",
            rows: opcoes.map((titulo, i) => ({
              id: `opt_${i}`,
              title: corta(titulo, 24),
            })),
          },
        ],
      },
    },
  };
}

export async function sendWhatsAppMessage(to, text) {
  // A peneira de tom roda ANTES do extrairOpcoes, de propósito: assim pega
  // tanto o texto da mensagem quanto os rótulos dos botões, que ainda estão
  // dentro do marcador [[opcoes: ...]]. Depois eles já viraram outra coisa.
  // Mesma ideia do humanize() logo abaixo: o prompt pede, isto garante.
  const { texto, opcoes } = extrairOpcoes(peneirarTom(text));
  const body = humanize(texto);

  const res = await postar(montarPayload(to, body, opcoes));

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("Failed to send WhatsApp message:", errorBody);
    return false;
  }

  try {
    const data = await res.json();
    guardarEnviada(to, idEnviado(data), body);
  } catch {
    // Sem o id, reação neste contato volta a ser ignorada. Não é motivo
    // para considerar o envio falho: a mensagem chegou.
  }

  return true;
}

/** Só para teste: injeta a última mensagem enviada sem chamar a Meta. */
export function __registrarEnviada(para, id, texto) {
  guardarEnviada(para, id, texto);
}

/**
 * Mensagem de TEMPLATE — o único jeito de falar com alguém fora da janela.
 *
 * A regra da Meta, desde julho de 2025: quando o paciente escreve, abre uma
 * janela de 24 horas em que a clínica responde texto livre de graça. Passadas
 * as 24 horas, a porta fecha: só entra mensagem que use um modelo aprovado
 * previamente, e ela é cobrada.
 *
 * É exatamente o caso do lembrete de consulta. A pessoa marcou há dez dias;
 * a janela fechou no mesmo dia. Por isso o lembrete não pode ser texto comum,
 * por mais bem escrito que seja: a Meta simplesmente não entrega.
 *
 * Categoria "utilidade", que é a mais barata — em torno de R$ 0,05 por
 * mensagem entregue no Brasil, contra sete vezes mais se fosse marketing.
 *
 * As variáveis entram na ordem em que aparecem no modelo: {{1}}, {{2}}, {{3}}.
 * Os botões de resposta rápida já fazem parte do modelo aprovado e não
 * precisam ser enviados aqui.
 */
export async function enviarTemplate(para, { nome, idioma = "pt_BR", variaveis = [] }) {
  if (!nome) return { ok: false, erro: "template sem nome" };

  const corpo = {
    messaging_product: "whatsapp",
    to: para,
    type: "template",
    template: {
      name: nome,
      language: { code: idioma },
      ...(variaveis.length
        ? {
            components: [
              {
                type: "body",
                parameters: variaveis.map((v) => ({ type: "text", text: String(v ?? "") })),
              },
            ],
          }
        : {}),
    },
  };

  let res;
  try {
    res = await postar(corpo);
  } catch (err) {
    return { ok: false, erro: `rede: ${err.message}` };
  }

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    // O erro da Meta aqui costuma ser um destes: modelo ainda não aprovado,
    // nome escrito diferente do cadastrado, ou idioma que não bate. Vale
    // registrar inteiro, porque a mensagem dela diz qual dos três é.
    console.error(`Template "${nome}" recusado pela Meta:`, texto);
    return { ok: false, erro: texto };
  }

  const dados = await res.json().catch(() => ({}));
  const id = idEnviado(dados);

  // Mesmo caminho da mensagem comum: guardar o id deixa a reação da paciente
  // ao lembrete ser entendida como resposta.
  guardarEnviada(para, id, `[template ${nome}]`);

  return { ok: true, id };
}

/**
 * Marca a mensagem como lida (dois tiques azuis) e mostra "digitando…".
 *
 * O indicador some sozinho quando a resposta é enviada, ou depois de 25s.
 * Se a versão da API não aceitar `typing_indicator`, cai para o simples
 * "marcar como lida" — nunca deixa o fluxo quebrar por causa de um enfeite.
 */
export async function markAsReadAndTyping(messageId) {
  if (!messageId) return;

  // A YCloud tem rota própria, que já marca como lida e mostra "digitando…".
  if (usaYCloud()) {
    try {
      await fetch(`${YCLOUD_API}/whatsapp/inboundMessages/${encodeURIComponent(messageId)}/typing`, {
        method: "POST",
        headers: cabecalhosYCloud(),
      });
    } catch (err) {
      console.error("markAsReadAndTyping failed (ignorado):", err.message);
    }
    return;
  }

  const body = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  };

  try {
    const res = await fetch(GRAPH_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...body, typing_indicator: { type: "text" } }),
    });

    if (res.ok) return;

    // Fallback: só marcar como lida.
    await fetch(GRAPH_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("markAsReadAndTyping failed (ignorado):", err.message);
  }
}

/**
 * Tipos que devem ser IGNORADOS em silêncio, sem resposta nenhuma.
 *
 * Uma reação (o joinha que o paciente dá numa mensagem) não é um pedido: é um
 * "ok, entendi" sem palavras. Responder a ela com "ainda não consigo
 * processar esse tipo de mensagem, pode escrever em texto?" é exatamente o
 * que nenhuma secretária faria, e entrega na hora que do outro lado tem uma
 * máquina seguindo regra. Aconteceu num teste real em 20/08, logo depois de
 * um atendimento que tinha corrido perfeito.
 *
 * A regra geral do agente é nunca deixar o paciente sem resposta. Reação é a
 * exceção: aqui o silêncio é a resposta certa, porque é o que um humano faria.
 */
const IGNORADOS = new Set([
  "system", // avisos de grupo, mudança de número
  "order",
  "ephemeral",
]);

/**
 * Reação como resposta.
 *
 * Muita gente confirma com um joinha em vez de digitar "sim". É o gesto mais
 * natural do WhatsApp, e obrigar a pessoa a escrever "pode seguir" quando ela
 * já disse que sim com o dedo é o tipo de atrito que faz o atendimento
 * parecer burocrático.
 *
 * Mas reação só vira resposta quando as três coisas valem:
 *
 *   1. É reação à ÚLTIMA mensagem que o agente enviou. Numa mensagem antiga é
 *      só alguém rolando a conversa.
 *   2. Essa mensagem era uma PERGUNTA DE CONFIRMAÇÃO ("confere?", "certo?",
 *      "né?"). Num "qual seu nome completo?" um joinha não responde nada, e
 *      num "prontinho, dados salvos" ele é só cortesia, que merece silêncio.
 *   3. O emoji tem sentido claro de sim ou de não.
 *
 * Fora disso, silêncio, que é o que uma secretária faria.
 */

/** Tira seletor de variação e tom de pele, para 👍🏽 e 👍 caírem no mesmo lugar. */
function emojiBase(e) {
  return String(e || "").replace(/[︎️]/g, "").replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
}

const SIM = new Set(["👍", "👌", "✅", "☑️", "✔", "❤", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "😍", "🥰", "😊", "🙏", "🤝", "💪", "🎉", "😀", "😁", "🙂"].map(emojiBase));
const NAO = new Set(["👎", "❌", "🚫", "😡", "😠"].map(emojiBase));

/**
 * A primeira versão listava as frases de confirmação: "confere?", "correto?",
 * "né?". Furou no primeiro teste real, num "Fechado?" que não estava na lista.
 * E ia furar sempre: a frase é gerada pelo modelo e muda toda vez. "Fechado?",
 * "Combinado?", "Posso marcar?", "Beleza?" são infinitas.
 *
 * A lógica certa é a inversa. O conjunto de perguntas onde um joinha NÃO
 * responde nada é pequeno e estável:
 *
 *   1. Pergunta aberta, com pronome interrogativo: "QUAL dia fica melhor?"
 *   2. Pergunta de escolha, com "ou": "primeira consulta OU retorno?"
 *   3. Pedido de dado: "pode ME PASSAR seu CPF?"
 *
 * Fora dessas três, pergunta do agente neste fluxo é confirmação, e joinha
 * quer dizer sim. Qualquer frase nova que o modelo invente cai no caminho
 * certo sem ninguém atualizar lista nenhuma.
 */
const ABERTA = /\b(qual|quais|quando|quanto|quantos|quantas|como|onde|quem|por\s*que|porque|que\s+horas|que\s+dia)\b/i;
const ESCOLHA = /\sou\s/i;
const PEDE_DADO = /\bme\s+(passar?|manda?r?|envia?r?|informa?r?|diz(er)?|fala?r?)\b|\bqual\s+(seu|sua)\b/i;

/** A última frase interrogativa da mensagem, que é a que o joinha responde. */
function perguntaFinal(texto) {
  const frases = String(texto || "")
    .split(/(?<=[.!?])\s+/)
    .filter((f) => f.includes("?"));
  return frases.length ? frases[frases.length - 1] : null;
}

function lerReacao(message, ultima) {
  const emoji = emojiBase(message.reaction?.emoji);
  const alvo = message.reaction?.message_id;

  // Reação removida chega com emoji vazio.
  if (!emoji) return null;
  if (!ultima || !alvo || alvo !== ultima.id) return null;

  const pergunta = perguntaFinal(ultima.texto);
  if (!pergunta) return null;
  if (ABERTA.test(pergunta) || ESCOLHA.test(pergunta) || PEDE_DADO.test(pergunta)) return null;

  if (SIM.has(emoji)) return "sim";
  if (NAO.has(emoji)) return "não";
  return null;
}

// Tipos que o agente ainda não processa, com uma resposta digna para cada.
// O pior cenário é o silêncio: o paciente manda um áudio e não recebe nada.
const UNSUPPORTED_REPLIES = {
  audio:
    "Ainda não consigo ouvir áudios por aqui. Pode me escrever em texto o que você precisa? " +
    "Assim eu te ajudo agora mesmo.",
  voice:
    "Ainda não consigo ouvir áudios por aqui. Pode me escrever em texto o que você precisa?",
  image:
    "Recebi sua imagem, mas ainda não consigo analisar fotos. Se for sobre agendamento, " +
    "me conta por texto que eu resolvo.",
  document:
    "Recebi seu arquivo, mas ainda não consigo abrir documentos por aqui. " +
    "Se for sobre agendamento, me diga por texto o que você precisa.",
  video: "Ainda não consigo assistir vídeos por aqui. Pode me escrever o que você precisa?",
  sticker: "Recebi sua figurinha. Como posso te ajudar hoje?",
  location:
    "Recebi sua localização. Se quiser saber como chegar até aqui, é só perguntar o endereço.",
  contacts: "Recebi o contato. Como posso te ajudar hoje?",

  // "unsupported" é o tipo que a PRÓPRIA META manda quando ela não conseguiu
  // entregar o conteúdo: enquete, mensagem de visualização única, mídia num
  // formato que a Cloud API não repassa. Não é figurinha nem áudio — é a
  // plataforma dizendo que o conteúdo não veio.
  //
  // Caiu no texto genérico em 04/09, e a pessoa que recebeu foi a Bruna, na
  // PRIMEIRA mensagem dela para o agente. A primeira impressão da primeira
  // cliente em potencial foi "não consigo processar esse tipo de mensagem".
  //
  // O texto abaixo não culpa a pessoa e não pede que ela mude de hábito: diz
  // que a mensagem não chegou, que é a verdade, e segue perguntando.
  unsupported:
    "Essa sua mensagem não chegou aqui, o WhatsApp não repassou o conteúdo. " +
    "Me conta por texto o que você precisa que eu te ajudo agora.",
};

export function unsupportedReplyFor(type) {
  return (
    UNSUPPORTED_REPLIES[type] ||
    "Ainda não consigo processar esse tipo de mensagem. Pode me escrever em texto o que você precisa?"
  );
}

/**
 * Extrai o que interessa do payload da Meta.
 *
 * Devolve `kind: "text"` para mensagem de texto, `kind: "unsupported"` para os
 * demais tipos (que merecem resposta, não silêncio), e null para o que não é
 * mensagem — atualizações de status de entrega, por exemplo.
 */
export function parseIncomingMessage(body) {
  try {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return null;

    // Devolver null faz o webhook tratar como "não é mensagem para responder",
    // que é o mesmo caminho já usado para atualização de status de entrega.
    if (IGNORADOS.has(message.type)) {
      console.log(`Ignorado em silêncio: "${message.type}" de ${message.from}`);
      return null;
    }

    if (message.type === "reaction") {
      const resposta = lerReacao(message, ultimaEnviada.get(String(message.from)));
      if (!resposta) {
        console.log(`Reação sem resposta pendente, ignorada: ${message.from}`);
        return null;
      }
      console.log(`Reação lida como "${resposta}": ${message.from}`);
      return {
        id: message.id,
        from: message.from,
        contactName: value.contacts?.[0]?.profile?.name || null,
        type: message.type,
        kind: "text",
        text: resposta,
      };
    }

    const common = {
      id: message.id,
      from: message.from,
      contactName: value.contacts?.[0]?.profile?.name || null,
      type: message.type,
    };

    if (message.type === "text") {
      return { ...common, kind: "text", text: message.text.body };
    }

    // Botão ou item de lista contam como texto para o agente.
    if (message.type === "interactive") {
      const i = message.interactive;
      const text = i?.button_reply?.title || i?.list_reply?.title;
      if (text) return { ...common, kind: "text", text };
    }

    if (message.type === "button" && message.button?.text) {
      return { ...common, kind: "text", text: message.button.text };
    }

    // Áudio e imagem têm tratamento próprio: são baixados e processados.
    if (message.type === "audio" || message.type === "voice") {
      return {
        ...common,
        kind: "audio",
        mediaId: message.audio?.id || message.voice?.id || null,
        mediaLink: message.audio?.link || message.voice?.link || null, // só na YCloud
        mimeType: message.audio?.mime_type || message.voice?.mime_type || null,
      };
    }

    if (message.type === "image") {
      return {
        ...common,
        kind: "image",
        mediaId: message.image?.id || null,
        mediaLink: message.image?.link || null,
        mimeType: message.image?.mime_type || null,
        caption: message.image?.caption || null,
      };
    }

    // PDF: é assim que chega quando o paciente usa "compartilhar carteirinha"
    // no app da operadora. Traz mais campos que o print da tela.
    if (message.type === "document") {
      const mime = String(message.document?.mime_type || "").toLowerCase();
      if (mime.includes("pdf")) {
        return {
          ...common,
          kind: "image", // mesmo tratamento: baixar e ler
          mediaId: message.document?.id || null,
          mediaLink: message.document?.link || null,
          mimeType: "application/pdf",
          caption: message.document?.caption || null,
          filename: message.document?.filename || null,
        };
      }
      // Outros documentos (docx, xlsx...) seguem sem tratamento.
    }

    // A Meta manda o PORQUÊ junto, em `errors`, e sem isso não há como saber o
    // que a pessoa tentou enviar. Em 04/09 o log registrou só
    // `type: "unsupported"` e ficou impossível dizer se a Bruna mandou uma
    // enquete, um áudio de visualização única ou outra coisa — e ela era a
    // primeira cliente em potencial a testar o agente.
    //
    // Guardar isto não expõe conteúdo nenhum: é o código e o título do erro da
    // plataforma, não a mensagem dela.
    const erro = message.errors?.[0];
    return {
      ...common,
      kind: "unsupported",
      motivo: erro ? `${erro.code || "?"} ${erro.title || erro.message || ""}`.trim() : null,
    };
  } catch {
    return null;
  }
}
