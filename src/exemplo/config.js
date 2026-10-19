// O negócio de exemplo: um salão fictício. Trocar de negócio = trocar esta
// pasta (ver src/exemplo/index.js). Nada aqui é de cliente real.
export const negocio = {
  nome: process.env.NEGOCIO_NOME || "Studio Exemplo",
  timezone: process.env.NEGOCIO_FUSO || "America/Sao_Paulo",
  atendente: "Léo",
  endereco: "Rua Fictícia, 123, Centro",
  abre: "09:00",
  fecha: "19:00",
  fechadoNoDia: [0], // 0 = domingo
  servicos: [
    { nome: "Corte", minutos: 30, preco: 50 },
    { nome: "Barba", minutos: 30, preco: 40 },
    { nome: "Corte e barba", minutos: 60, preco: 80 },
  ],
  profissionais: ["Ana", "Bruno", "Caio"],
};
