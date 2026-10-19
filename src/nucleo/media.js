/**
 * Download de mídia enviada pelo paciente (áudio, imagem).
 *
 * A Meta não manda o arquivo no webhook — manda um id. São duas chamadas:
 * primeiro pega a URL temporária, depois baixa o binário. As duas exigem o
 * token de autorização; a URL sozinha não serve para nada.
 *
 * O arquivo NUNCA é gravado em disco. Foto de carteirinha e áudio de paciente
 * são dados sensíveis: passam pela memória, são usados, e somem.
 */

import { usaYCloud, cabecalhosYCloud, linkDaYCloud } from "./ycloud.js";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

// Limites por segurança. A Meta já limita, mas não confiamos em limite alheio.
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

/**
 * Pela YCloud é uma chamada só: o evento já traz o link do arquivo, que exige
 * a X-API-Key. A chave só vai para link da própria YCloud.
 */
async function baixarDaYCloud(link) {
  if (!linkDaYCloud(link)) return { error: "media link is not from YCloud" };

  const { "X-API-Key": chave } = cabecalhosYCloud();
  const fileRes = await fetch(link, { headers: { "X-API-Key": chave } });
  if (!fileRes.ok) {
    return { error: `media download failed: ${fileRes.status}` };
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return { error: "media too large" };
  }

  // Tipo genérico vira null para valer o mime_type que veio no evento (server.js).
  const tipo = fileRes.headers.get("content-type");
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: tipo && !tipo.startsWith("application/octet-stream") ? tipo : null,
    bytes: arrayBuffer.byteLength,
  };
}

export async function downloadMedia(mediaId, mediaLink = null) {
  if (usaYCloud()) return baixarDaYCloud(mediaLink);
  if (!mediaId) return { error: "missing media id" };

  const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };

  // 1) metadados, incluindo a URL temporária
  const metaRes = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
    { headers }
  );

  if (!metaRes.ok) {
    return { error: `media metadata failed: ${metaRes.status}` };
  }

  const meta = await metaRes.json();

  if (meta.file_size && Number(meta.file_size) > MAX_BYTES) {
    return { error: "media too large" };
  }

  // 2) o binário. A URL exige o mesmo Bearer.
  const fileRes = await fetch(meta.url, { headers });
  if (!fileRes.ok) {
    return { error: `media download failed: ${fileRes.status}` };
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return { error: "media too large" };
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream",
    bytes: arrayBuffer.byteLength,
  };
}
