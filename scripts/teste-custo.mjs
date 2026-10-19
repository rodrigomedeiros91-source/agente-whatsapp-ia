// Conferência da conta de custo. Rode da raiz:
//   node scripts/teste-custo.mjs
//
// A aritmética aqui vira preço de venda, então ela precisa estar certa antes
// de alguém prometer mensalidade a uma clínica.
import { registrarUso, linhaDaMensagem, resumo, encerrarTudo } from "../src/nucleo/custo.js";
import { criarVerificador } from "./verificador.mjs";

const { check, encerrar } = criarVerificador();

// Sonnet 5: US$2 por milhão de entrada, US$10 de saída.
// 1.000.000 de entrada + 1.000.000 de saída = US$12 exatos.
registrarUso("5521999990001", { input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-sonnet-5");
const r1 = resumo();
check("conta de entrada e saída bate com a tabela", Math.abs(r1.usdTotal - 12) < 1e-9);

// Cache: leitura custa 1/10 da entrada normal.
registrarUso("5521999990002", { cache_read_input_tokens: 1_000_000 }, "claude-sonnet-5");
const r2 = resumo();
check("leitura de cache custa 10 vezes menos", Math.abs(r2.usdTotal - 12 - 0.2) < 1e-9);

// Escrita de cache de 5 minutos: 1,25x a entrada.
registrarUso("5521999990003", { cache_creation_input_tokens: 1_000_000 }, "claude-sonnet-5");
check("escrita de cache custa 1,25x a entrada", Math.abs(resumo().usdTotal - 12.2 - 2.5) < 1e-9);

// Modelo desconhecido não pode zerar a conta silenciosamente.
registrarUso("5521999990004", { input_tokens: 1_000_000 }, "modelo-que-nao-existe");
check("modelo desconhecido cai no preço padrão, não em zero", resumo().usdTotal > 14.7);

// Várias rodadas de ferramenta na MESMA conversa somam numa conversa só.
registrarUso("5521988880000", { input_tokens: 10_000, output_tokens: 500 }, "claude-sonnet-5");
registrarUso("5521988880000", { input_tokens: 12_000, output_tokens: 300 }, "claude-sonnet-5");
registrarUso("5521988880000", { input_tokens: 14_000, output_tokens: 700 }, "claude-sonnet-5");
const linha = linhaDaMensagem("5521988880000");
check("as rodadas somam numa conversa só", linha.includes("3 chamada(s)"));
check("o log mostra só os 4 últimos dígitos do telefone", linha.includes("...0000") && !linha.includes("5521988880000"));

const final = encerrarTudo();
check("todas as conversas entram na média", final.conversasEncerradas === 5);
check("nada fica aberto depois de encerrar", final.conversasAbertas === 0);
check("a projeção mensal é a média vezes 200", Math.abs(final.projecao200 - final.usdMediaPorConversa * 200) < 1e-9);

console.log("\n" + final.texto);
encerrar();
