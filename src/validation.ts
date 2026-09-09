export type VisitKind = "repair" | "to" | "diag";

export type BookingInput = {
  kind: string;
  brand: string;
  model: string;
  mileage?: string;
  service: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  note?: string;
  consent: boolean;
};

export type Booking = BookingInput & {
  id: number;
  status?: "new" | "in_progress" | "done" | "cancelled";
};

export const SLOTS = [
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
] as const;

/** Клиент вписывает ровно 4 цифры: ДДММ, например «2409». */
const DAY_MONTH_DIGITS = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])$/;

/**
 * Переводит ввод «ДДММ» в ISO-дату ближайшего такого дня.
 * Год указывать не нужно: если день в этом году уже прошёл, берём следующий.
 */
export function parseBookingDate(value: string, now = new Date()): string | null {
  const digits = value.replace(/\D/g, "");
  const match = DAY_MONTH_DIGITS.exec(digits);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const candidate = new Date(year, month - 1, day);
    candidate.setHours(0, 0, 0, 0);
    const dayExists = candidate.getMonth() === month - 1 && candidate.getDate() === day;
    if (dayExists && candidate >= today) return toISODate(candidate);
  }
  return null;
}

/** Оставляет только цифры даты, не больше 4 символов. */
export function sanitizeDateInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

/** Приводит дату к виду «2409» для поля ввода. */
export function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return month && day ? `${day}${month}` : "";
}

/** Человеческая подпись сохранённой даты: «чт, 10 сентября». */
export function formatBookingDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, day));
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function phoneOk(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    repair: "ремонт",
    to: "ТО",
    diag: "диагностику",
  };
  return map[kind] ?? "визит";
}

/** Название направления для списка заявок, когда услуга не выбрана. */
export function kindTitle(kind: string): string {
  const map: Record<string, string> = {
    repair: "Ремонт",
    to: "Техническое обслуживание",
    diag: "Диагностика",
  };
  return map[kind] ?? "Визит";
}

/** Текст окна после отправки: клиенту звонят, а не просят звонить самому. */
export function bookingDoneMessage(
  data: Pick<BookingInput, "name" | "kind" | "service" | "phone">,
): string {
  const extra = data.service.trim() ? ` Указали: ${data.service}.` : "";
  return `${data.name}, заявка на ${kindLabel(data.kind)} принята.${extra} Мы перезвоним вам на ${data.phone} и подтвердим время визита.`;
}

/** Успешная проверка отдаёт дату в ISO — её и сохраняем. */
export type BookingField =
  | "consent"
  | "brand"
  | "model"
  | "date"
  | "time"
  | "name"
  | "phone";

export type BookingCheck =
  | { ok: true; date: string }
  | { ok: false; message: string; field: BookingField };

export function validateBooking(data: BookingInput, now = new Date()): BookingCheck {
  if (!data.brand?.trim()) {
    return { ok: false, field: "brand", message: "Укажите марку автомобиля." };
  }
  if (!data.model?.trim()) {
    return { ok: false, field: "model", message: "Укажите модель автомобиля." };
  }
  if (!String(data.date || "").trim()) {
    return { ok: false, field: "date", message: "Укажите дату визита — 4 цифры ДДММ, например 2409." };
  }
  const date = parseBookingDate(data.date, now);
  if (!date) {
    return {
      ok: false,
      field: "date",
      message: "Дата указана неверно. Нужны 4 цифры ДДММ: день 01–31, месяц 01–12. Например, 2409.",
    };
  }
  if (!data.time?.trim()) {
    return { ok: false, field: "time", message: "Выберите удобное время визита." };
  }
  if (!data.name?.trim()) {
    return { ok: false, field: "name", message: "Укажите ваше имя." };
  }
  if (!phoneOk(data.phone ?? "")) {
    return {
      ok: false,
      field: "phone",
      message: "Проверьте телефон — нужно не меньше 10 цифр.",
    };
  }
  if (!data.consent) {
    return {
      ok: false,
      field: "consent",
      message: "Чтобы отправить заявку, отметьте согласие на обработку персональных данных.",
    };
  }
  return { ok: true, date };
}
