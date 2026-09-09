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
  it("принимает российский номер", () => {
    expect(phoneOk("+7 901 372-03-12")).toBe(true);
    expect(phoneOk("89013720312")).toBe(true);
  });

  it("отклоняет слишком короткий номер", () => {
    expect(phoneOk("12345")).toBe(false);
  });
});

describe("validateBooking", () => {
  const now = new Date("2026-09-09T12:00:00");
  const base = {
    kind: "repair",
    brand: "Toyota",
    model: "Camry",
    service: "ТО-1 · 10 000 км",
    date: "2409",
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
    expect(validateBooking({ ...base, date: "3112", time: "19:00" }, now)).toEqual({
      ok: true,
      date: "2026-12-31",
    });
    expect(validateBooking({ ...base, date: "0503" }, now)).toEqual({
      ok: true,
      date: "2027-03-05",
    });
  });

  it("сообщает о непонятной дате", () => {
    const result = validateBooking({ ...base, date: "как-нибудь" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ДДММ");
    }
  });

  it("проверяет обязательные поля", () => {
    const result = validateBooking({ ...base, model: "", name: "" }, now);
    expect(result.ok).toBe(false);
  });

  it("требует марку, но принимает любую введённую", () => {
    expect(validateBooking({ ...base, brand: "   " }, now).ok).toBe(false);
    expect(validateBooking({ ...base, brand: "Chery" }, now).ok).toBe(true);
    expect(validateBooking({ ...base, brand: "ГАЗ" }, now).ok).toBe(true);
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

  it("принимает ровно 4 цифры ДДММ", () => {
    expect(parseBookingDate("2409", now)).toBe("2026-09-24");
    expect(parseBookingDate("24.09", now)).toBe("2026-09-24");
    expect(parseBookingDate("0102", now)).toBe("2027-02-01");
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
  it("оставляет только 4 цифры", () => {
    expect(sanitizeDateInput("24.09")).toBe("2409");
    expect(sanitizeDateInput("ab12cd345")).toBe("1234");
    expect(sanitizeDateInput("")).toBe("");
  });
});

describe("helpers", () => {
  it("подписывает тип визита", () => {
    expect(kindLabel("to")).toBe("ТО");
    expect(kindTitle("diag")).toBe("Диагностика");
  });

  it("подписывает сохранённую дату без года", () => {
    expect(formatBookingDate("2026-09-10")).toContain("10 сентября");
    expect(formatBookingDate("2026-09-10")).not.toContain("2026");
    expect(formatBookingDate("")).toBe("");
  });

  it("возвращает дату в поле в виде «ДДММ»", () => {
    expect(formatDayMonth("2026-09-04")).toBe("0409");
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
