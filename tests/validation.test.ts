import { describe, expect, it } from "vitest";
import { createCookiePreferences, parseCookiePreferences } from "../src/cookies";
import {
  bookingDoneMessage,
  formatBookingDate,
  formatDayMonth,
  kindLabel,
  kindTitle,
  parseBookingDate,
  phoneOk,
  sanitizeDateInput,
  validateBooking,
} from "../src/validation";

describe("phoneOk", () => {
  it("принимает российский номер +7", () => {
    expect(phoneOk("+7 901 372-03-12")).toBe(true);
    expect(phoneOk("89013720312")).toBe(true);
    expect(phoneOk("79013720312")).toBe(true);
  });

  it("отклоняет иностранные и короткие номера", () => {
    expect(phoneOk("12345")).toBe(false);
    expect(phoneOk("+1 202 555 0133")).toBe(false);
    expect(phoneOk("+7 901 372")).toBe(false);
  });
});

describe("validateBooking", () => {
  const now = new Date("2026-09-09T12:00:00");
  const base = {
    kind: "repair",
    brand: "Toyota",
    model: "Camry",
    service: "ТО-1 · 10 000 км",
    date: "24.09",
    time: "11:00",
    name: "Иван",
    phone: "+79013720312",
    consent: true,
  };

  it("требует активное согласие", () => {
    const result = validateBooking({ ...base, consent: false }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.toLowerCase()).toContain("согласие");
    }
  });

  it("пропускает корректную заявку и отдаёт дату в ISO", () => {
    expect(validateBooking(base, now)).toEqual({ ok: true, date: "2026-09-24" });
  });

  it("не проверяет занятость: принимает любой корректный день", () => {
    expect(validateBooking({ ...base, date: "31.12", time: "19:00" }, now)).toEqual({
      ok: true,
      date: "2026-12-31",
    });
    expect(validateBooking({ ...base, date: "05.03" }, now)).toEqual({
      ok: true,
      date: "2027-03-05",
    });
  });

  it("сообщает о непонятной дате", () => {
    const result = validateBooking({ ...base, date: "как-нибудь" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ДД.ММ");
    }
  });

  it("проверяет обязательные поля по одному и указывает конкретное", () => {
    const result = validateBooking({ ...base, model: "", name: "" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("model");
      expect(result.message.toLowerCase()).toContain("модель");
      expect(result.message.toLowerCase()).not.toContain("имя");
    }
  });

  it("отдельно указывает на имя, если остальные поля заполнены", () => {
    const result = validateBooking({ ...base, name: "" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("name");
      expect(result.message.toLowerCase()).toContain("имя");
    }
  });

  it("требует марку, но принимает любую введённую", () => {
    expect(validateBooking({ ...base, brand: "   " }, now).ok).toBe(false);
    expect(validateBooking({ ...base, brand: "Chery" }, now).ok).toBe(true);
    expect(validateBooking({ ...base, brand: "ГАЗ" }, now).ok).toBe(true);
  });

  it("принимает направление специфических работ", () => {
    expect(
      validateBooking({ ...base, kind: "special", service: "KDSS — диагностика и ремонт" }, now),
    ).toEqual({
      ok: true,
      date: "2026-09-24",
    });
  });

  it("не требует конкретную услугу — достаточно направления", () => {
    expect(validateBooking({ ...base, service: "" }, now)).toEqual({
      ok: true,
      date: "2026-09-24",
    });
  });
});

describe("parseBookingDate", () => {
  const now = new Date("2026-09-09T12:00:00");

  it("принимает ДД.ММ и 4 цифры без точки", () => {
    expect(parseBookingDate("24.09", now)).toBe("2026-09-24");
    expect(parseBookingDate("2409", now)).toBe("2026-09-24");
    expect(parseBookingDate("01.02", now)).toBe("2027-02-01");
  });

  it("отклоняет день/месяц вне диапазона и мусор", () => {
    expect(parseBookingDate("3102", now)).toBeNull();
    expect(parseBookingDate("0009", now)).toBeNull();
    expect(parseBookingDate("2413", now)).toBeNull();
    expect(parseBookingDate("3201", now)).toBeNull();
    expect(parseBookingDate("9", now)).toBeNull();
    expect(parseBookingDate("завтра", now)).toBeNull();
    expect(parseBookingDate("", now)).toBeNull();
  });
});

describe("sanitizeDateInput", () => {
  it("ставит точку после дня", () => {
    expect(sanitizeDateInput("24.09")).toBe("24.09");
    expect(sanitizeDateInput("2409")).toBe("24.09");
    expect(sanitizeDateInput("ab12cd345")).toBe("12.34");
    expect(sanitizeDateInput("24")).toBe("24");
    expect(sanitizeDateInput("")).toBe("");
  });
});

describe("helpers", () => {
  it("подписывает тип визита", () => {
    expect(kindLabel("to")).toBe("ТО");
    expect(kindTitle("diag")).toBe("Диагностика");
    expect(kindLabel("special")).toBe("специфические работы");
    expect(kindTitle("special")).toBe("Специфические работы");
  });

  it("подписывает сохранённую дату без года", () => {
    expect(formatBookingDate("2026-09-10")).toContain("10 сентября");
    expect(formatBookingDate("2026-09-10")).not.toContain("2026");
    expect(formatBookingDate("")).toBe("");
  });

  it("возвращает дату в поле в виде «ДД.ММ»", () => {
    expect(formatDayMonth("2026-09-04")).toBe("04.09");
    expect(formatDayMonth("")).toBe("");
  });

  it("в сообщении об успехе обещает звонок клиенту, а не просит звонить", () => {
    const withService = bookingDoneMessage({
      name: "Иван",
      kind: "repair",
      service: "Ходовая и тормоза",
      phone: "+79013720312",
    });
    const withoutService = bookingDoneMessage({
      name: "Иван",
      kind: "to",
      service: "",
      phone: "+79013720312",
    });
    expect(withService).toContain("Мы перезвоним вам");
    expect(withService).toContain("Ходовая и тормоза");
    expect(withService.toLowerCase()).not.toContain("позвоните");
    expect(withoutService).toContain("заявка на ТО принята");
    expect(withoutService).not.toContain("Указали:");
  });
});

describe("cookie preferences", () => {
  it("не отмечает функциональные cookie по умолчанию", () => {
    const prefs = createCookiePreferences(false, new Date("2026-09-09T00:00:00Z"));
    expect(prefs.necessary).toBe(true);
    expect(prefs.functional).toBe(false);
  });

  it("разбирает сохранённый выбор", () => {
    expect(parseCookiePreferences(null)).toBeNull();
    expect(parseCookiePreferences("{")).toBeNull();
    expect(
      parseCookiePreferences(JSON.stringify({ necessary: true, functional: true, updatedAt: "x" })),
    ).toEqual({ necessary: true, functional: true, updatedAt: "x" });
  });
});
