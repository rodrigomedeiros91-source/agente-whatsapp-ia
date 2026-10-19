/**
 * Utilitários de tempo com suporte real a fuso horário.
 *
 * Antes, o projeto escrevia "-03:00" na mão. Isso só funciona no Brasil e só
 * enquanto não houver horário de verão. Para atender clientes em qualquer país,
 * o deslocamento precisa ser calculado para a data específica — porque em fusos
 * com DST ele muda ao longo do ano.
 *
 * Tudo aqui usa Intl, que é nativo do Node. Sem dependência extra.
 */

/**
 * Deslocamento do fuso, em minutos, no instante informado.
 * Positivo a leste de Greenwich. São Paulo devolve -180.
 */
export function tzOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const p = Object.fromEntries(
    dtf.formatToParts(date).map((part) => [part.type, part.value])
  );

  // Monta o "relógio de parede" daquele fuso como se fosse UTC e compara
  // com o instante real. A diferença é o deslocamento.
  const asIfUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );

  return Math.round((asIfUTC - date.getTime()) / 60000);
}

/** Converte -180 em "-03:00", 330 em "+05:30". */
export function offsetString(minutes) {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Recebe uma data/hora local ("2026-08-11", "10:30") de um fuso e devolve
 * o instante correspondente como objeto Date (UTC por dentro).
 *
 * Faz duas passagens: a primeira estima o deslocamento, a segunda confere.
 * Isso resolve os dias de virada do horário de verão, em que o deslocamento
 * antes e depois da hora pedida é diferente.
 */
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  const wallAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);

  const firstGuess = tzOffsetMinutes(timeZone, new Date(wallAsUTC));
  let instant = wallAsUTC - firstGuess * 60000;

  const secondGuess = tzOffsetMinutes(timeZone, new Date(instant));
  if (secondGuess !== firstGuess) {
    instant = wallAsUTC - secondGuess * 60000;
  }

  return new Date(instant);
}

/**
 * String RFC3339 com o deslocamento correto para aquela data e fuso.
 * Ex.: ("2026-08-11", "10:30", "America/Sao_Paulo") -> "2026-08-11T10:30:00-03:00"
 * Em Nova York no verão devolveria "-04:00"; no inverno, "-05:00".
 */
export function toRFC3339(dateStr, timeStr, timeZone) {
  const instant = zonedTimeToUtc(dateStr, timeStr, timeZone);
  const offset = offsetString(tzOffsetMinutes(timeZone, instant));
  return `${dateStr}T${timeStr}:00${offset}`;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Dia da semana (0 = domingo) da data, no fuso informado.
 * Não usa o fuso do servidor — que pode estar em UTC e virar o dia.
 */
export function weekdayInZone(dateStr, timeZone) {
  const instant = zonedTimeToUtc(dateStr, "12:00", timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(instant);
  return WEEKDAY_INDEX[label];
}

/** Data, hora e dia da semana atuais no fuso do negócio. */
export function nowInZone(timeZone) {
  const now = new Date();

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  const weekday = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
  }).format(now);

  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday,
    year: parts.year,
    instant: now,
  };
}

/** "10:00" + 45 -> "10:45". Usado para calcular o fim de cada bloco. */
export function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Caminho inverso: recebe um instante (o que o Google Calendar devolve) e
 * quebra em data e hora locais do negócio, para mostrar ao paciente.
 */
export function instantToZoned(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  const weekday = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
  }).format(date);

  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday,
  };
}
