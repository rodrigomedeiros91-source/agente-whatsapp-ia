/**
 * Transcrição de áudio.
 *
 * Por que isso importa mais no Brasil do que parece: muito paciente manda
 * áudio por padrão — e é justamente o público mais velho, que é quem mais
 * marca consulta. Um agente de clínica que ignora áudio perde atendimento real.
 *
 * O WhatsApp envia áudio em OGG/Opus. A API de transcrição aceita direto,
 * sem conversão.
 *
 * Se não houver chave configurada, devolve null — e o agente cai na resposta
 * educada pedindo texto. Degradar com elegância é melhor do que quebrar.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = process.env.TRANSCRIPTION_MODEL || "whisper-1";

export function transcriptionAvailable() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function transcribeAudio(buffer, mimeType) {
  if (!transcriptionAvailable()) return null;

  try {
    const extension = mimeType?.includes("mp4")
      ? "mp4"
      : mimeType?.includes("mpeg")
        ? "mp3"
        : mimeType?.includes("wav")
          ? "wav"
          : "ogg";

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType || "audio/ogg" }), `audio.${extension}`);
    form.append("model", MODEL);
    form.append("language", process.env.TRANSCRIPTION_LANGUAGE || "pt");

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!res.ok) {
      // Diagnóstico no log em vez de um número solto. "Transcrição falhou:
      // 429" não conta a ninguém que o problema é falta de crédito, e o
      // sintoma que a clínica enxerga é só o agente pedindo texto de novo,
      // como se a funcionalidade não existisse.
      const motivo =
        {
          401: "chave da OpenAI inválida ou revogada",
          403: "acesso negado ao modelo de áudio neste projeto",
          404: "modelo de transcrição inexistente (confira TRANSCRIPTION_MODEL)",
          413: "áudio grande demais para a API",
          429: "SEM CRÉDITO na OpenAI, ou limite de uso atingido",
        }[res.status] || `erro ${res.status}`;

      console.error(
        `Transcrição falhou: ${motivo}. ` +
          "Rode `node scripts/teste-openai.mjs` para diagnosticar. " +
          "O paciente recebeu a resposta pedindo texto."
      );
      return null;
    }

    const data = await res.json();
    const text = String(data.text || "").trim();

    // Log seguro: tamanho, nunca o conteúdo. O que o paciente disse no áudio
    // pode ser qualquer coisa, inclusive informação de saúde.
    console.log(`Áudio transcrito (${text.length} caracteres).`);

    return text || null;
  } catch (err) {
    console.error("Transcrição falhou:", err.message);
    return null;
  }
}
