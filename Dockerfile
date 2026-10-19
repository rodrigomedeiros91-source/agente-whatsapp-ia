# Como o agente é montado para rodar num servidor.
#
# Por que existe: a Railway montava uma pasta de cache dentro de
# node_modules/.cache, e o `npm ci` começa apagando o node_modules inteiro.
# Apagar uma pasta que o Docker está segurando dá EBUSY, e a publicação
# falhava antes mesmo de o agente rodar. Três tentativas por variável de
# ambiente não resolveram, porque a variável certa muda conforme o construtor
# que a hospedagem usa naquele mês.
#
# Com este arquivo, quem decide como montar é o projeto, não a hospedagem.
# Some a classe inteira de problema, e de quebra o mesmo agente passa a subir
# igual na Railway, no Render, na Fly ou numa VPS — o que importa quando cada
# cliente novo é uma instalação nova.

# A mesma versão do .node-version, para o servidor rodar o que foi testado.
FROM node:22-slim

WORKDIR /app

# Só o manifesto primeiro. Assim, enquanto as dependências não mudarem, o
# Docker reaproveita esta camada e a publicação de uma correção de texto leva
# segundos em vez de minutos.
COPY package.json package-lock.json ./

# --omit=dev porque não há dependência de desenvolvimento em produção.
# Sem nenhum --mount aqui: é essa ausência que resolve o EBUSY.
RUN npm ci --omit=dev

# Agora o código.
COPY . .

ENV NODE_ENV=production

# A porta quem escolhe é a hospedagem, pela variável PORT. Este EXPOSE é
# documentação para quem lê, não configuração.
EXPOSE 3000

# Node direto, sem npm no meio — de propósito.
#
# Com `npm start`, a árvore de processos vira npm -> sh -> node, e quem recebe
# o SIGTERM da publicação é o npm. Se ele não repassar direito, o node morre
# sem passar pelo desligamento, e a conversa de quem estava no meio de um
# cadastro se perde sem deixar rastro. Em 25/08 a linha
# "SIGTERM: encerrando." não apareceu no log da Railway, e essa árvore é a
# suspeita mais provável.
#
# Assim o node é o processo principal, recebe o sinal em primeira mão, e some
# de quebra o `npm error signal SIGTERM` em vermelho a cada publicação — que
# não era erro nenhum, só o npm reclamando de ter sido desligado.
#
# CUIDADO: este CMD só vale se ninguém mandar outra coisa por cima. O
# `railway.json` tinha `deploy.startCommand: "npm start"`, e ele ganha do
# Dockerfile — o campo no painel da Railway aparecia até travado, com o aviso
# "The value is set in /railway.json". Trocar aqui sem tirar de lá não muda
# nada. O `teste-repositorio.mjs` reprova se o startCommand voltar.
CMD ["node", "src/server.js"]
