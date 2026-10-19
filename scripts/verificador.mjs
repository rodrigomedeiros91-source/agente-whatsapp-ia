// O "ok / FALHA" que todo teste usa. Rode a suíte com: npm test
export function criarVerificador() {
  const estado = { falhas: 0 };

  const check = (nome, condicao) => {
    if (condicao) {
      console.log(`ok   ${nome}`);
    } else {
      estado.falhas++;
      console.log(`FALHA ${nome}`);
    }
  };

  const encerrar = () => {
    console.log(
      estado.falhas === 0 ? "\ntodos os casos passaram" : `\n${estado.falhas} falha(s)`
    );
    process.exit(estado.falhas === 0 ? 0 : 1);
  };

  return { check, encerrar, estado };
}
