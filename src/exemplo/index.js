// O negócio de exemplo: o que o núcleo chama (ver src/nucleo/claude.js).
//
// O núcleo não sabe qual negócio atende: o server.js passa este módulo.
// Outro negócio = outra pasta com a mesma interface.
import { negocio } from "./config.js";

export { buildSystemBlocks, buildSystemPrompt } from "./prompt.js";
export { toolsAtivas, runTool, toolDefinitions } from "./tools.js";

export const nome = "exemplo";

export function rotulo() {
  return negocio.nome;
}
