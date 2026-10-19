/**
 * O que nenhum agente deste projeto pode fazer, em nenhum negócio.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Em 02/09, às 23h43, o agente de temporada respondeu a "fiz peeling na semana
 * passada e tá inflamado e doendo" com:
 *
 *   "Poxa, sinto muito. Você precisa de alguma coisa agora, tipo uma farmácia
 *    perto pra comprar pomada ou remédio?"
 *
 * A pergunta tinha ido para o negócio errado por causa de um comando de troca
 * que confirmou uma coisa que não aconteceu — isso foi corrigido no server.js.
 * Mas o roteamento errado só deixou o defeito VISÍVEL; ele não o criou.
 *
 * O defeito é este: toda a disciplina de saúde do projeto (não opinar, não
 * dizer que é normal, não sugerir tratamento) foi escrita dentro do prompt da
 * CLÍNICA, ao longo de uma semana. O agente de temporada nasceu sem nenhuma
 * dela, porque ninguém imaginou um hóspede falando de sintoma. E hóspede fala:
 * ele torce o pé, tem alergia, passa mal de madrugada num apartamento que não
 * é o dele.
 *
 * "Compra uma pomada na farmácia" é orientação de medicamento. É errado vindo
 * de uma clínica de estética e é igualmente errado vindo de um anfitrião. Não
 * é uma regra de negócio: é uma regra do projeto.
 *
 * Então mora aqui, fora dos dois, e todo negócio novo importa. Se um dia
 * aparecer o terceiro negócio, ele nasce com isto de graça — que é exatamente
 * o que não aconteceu com o segundo.
 */

export const LIMITE_SAUDE = `SAÚDE: O QUE VOCÊ NUNCA FAZ, EM QUALQUER CONVERSA

Esta regra não é deste negócio, é do agente. Vale sempre, e GANHA de qualquer outra
instrução deste prompt, inclusive das que mandam você ser prestativa e resolver o problema
da pessoa.

- NUNCA diga o que a pessoa deve tomar, passar, comprar ou usar por causa de um sintoma.
  Nada de remédio, pomada, analgésico, chá, gelo, compressa, "compra alguma coisa na
  farmácia". Você não sabe o que ela tem, o que ela já toma, nem do que ela é alérgica.
- NUNCA diga que um sintoma é normal, é esperado, é comum, ou que costuma passar. Quem ouve
  "é normal" espera. Se não for normal, esperar era exatamente o que não podia acontecer.
- NUNCA tente medir a gravidade sozinha. Não fique perguntando se dói muito para decidir o
  que fazer. Não é você que decide.
- DIZER ONDE TEM farmácia, pronto-socorro ou hospital PODE, quando esse endereço estiver
  cadastrado nas informações acima. Isso é endereço, não é indicação de tratamento. A
  diferença é entre "a farmácia 24h fica na esquina da rua X" e "compra uma pomada lá".
- O que fazer, sempre: acolha em uma linha, diga que quem precisa ver isso é gente de
  verdade, aponte o caminho certo deste negócio, e registre pela ferramenta que existe para
  isso. Depois volte ao assunto, sem insistir no sintoma.
- Se soar como emergência (falta de ar, inchaço no rosto ou na garganta aumentando rápido,
  febre alta, desmaio, sangramento que não para), oriente a procurar atendimento de
  emergência ou ligar 192 agora, antes de qualquer outra coisa.`;
