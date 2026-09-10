import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/chakra-petch/latin-700.css";
import "@fontsource/chakra-petch/latin-700-italic.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";

import { COOKIE_CONSENT_KEY, OPERATOR } from "./operator";
import { createCookiePreferences, parseCookiePreferences, type CookiePreferences } from "./cookies";
import { initReveal, initScrollUi } from "./motion";
import { fetchHealth, lookupBookings, submitBooking } from "./api";
import { loadBookings, removeBooking, saveBookings } from "./storage";
import {
  SLOTS,
  bookingDoneMessage,
  formatBookingDate,
  formatDayMonth,
  kindTitle,
  parseBookingDate,
  sanitizeDateInput,
  sanitizePhoneInput,
  formatPhoneStored,
  validateBooking,
  type Booking,
  type BookingField,
  type BookingInput,
} from "./validation";
import "./style.css";

const REVEAL_TARGETS = [
  ".section-head",
  ".service-item",
  ".to-block",
  ".to-note",
  ".booking-copy",
  ".form",
  ".contacts-panel",
  ".map-wrap",
  ".gallery-shot",
  ".review",
] as const;

function qs<T extends HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Элемент не найден: ${sel}`);
  return el as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readCookiePrefs(): CookiePreferences | null {
  return parseCookiePreferences(localStorage.getItem(COOKIE_CONSENT_KEY));
}

function writeCookiePrefs(prefs: CookiePreferences): void {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefs));
}

function applyMap(prefs: CookiePreferences | null): void {
  const host = document.getElementById("map-host");
  if (!host) return;

  if (prefs?.functional) {
    host.innerHTML = `<iframe title="TLS на Яндекс Картах" src="${OPERATOR.mapWidget}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    return;
  }

  host.innerHTML = `
    <div class="map-placeholder">
      <p>Карта Яндекса загружается только после согласия на функциональные cookie.</p>
      <div class="map-placeholder-actions">
        <button type="button" class="btn btn-accent" data-enable-map>Разрешить карту</button>
        <a class="btn btn-ghost" href="${OPERATOR.mapUrl}" target="_blank" rel="noopener noreferrer">Открыть в Яндекс Картах</a>
      </div>
    </div>
  `;

  host.querySelector("[data-enable-map]")?.addEventListener("click", () => {
    const next = createCookiePreferences(true);
    writeCookiePrefs(next);
    hideBanner();
    applyMap(next);
  });
}

function hideBanner(): void {
  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = true;
}

function showBanner(): void {
  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = false;
}

function initCookieBanner(): void {
  const existing = readCookiePrefs();
  if (existing) {
    hideBanner();
    applyMap(existing);
    return;
  }

  showBanner();
  applyMap(null);

  qs<HTMLButtonElement>("[data-cookie-necessary]").addEventListener("click", () => {
    const prefs = createCookiePreferences(false);
    writeCookiePrefs(prefs);
    hideBanner();
    applyMap(prefs);
  });

  qs<HTMLButtonElement>("[data-cookie-all]").addEventListener("click", () => {
    const prefs = createCookiePreferences(true);
    writeCookiePrefs(prefs);
    hideBanner();
    applyMap(prefs);
  });

  qs<HTMLButtonElement>("[data-cookie-settings]").addEventListener("click", () => {
    const panel = qs<HTMLElement>("#cookie-settings");
    panel.hidden = !panel.hidden;
  });

  qs<HTMLFormElement>("#cookie-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const functional = qs<HTMLInputElement>("#cookie-functional").checked;
    const prefs = createCookiePreferences(functional);
    writeCookiePrefs(prefs);
    hideBanner();
    applyMap(prefs);
  });
}

function fillTimes(select: HTMLSelectElement): void {
  select.innerHTML =
    `<option value="">Выбрать удобное время</option>` +
    SLOTS.map((t) => `<option value="${t}">${t}</option>`).join("");
}

/** Дата — ДД.ММ; точка ставится автоматически при вводе. */
function initDateField(input: HTMLInputElement): void {
  input.addEventListener("input", () => {
    const next = sanitizeDateInput(input.value);
    if (input.value !== next) input.value = next;
  });

  input.addEventListener("blur", () => {
    const iso = parseBookingDate(input.value);
    if (iso) input.value = formatDayMonth(iso);
  });
}

/** Телефон всегда с +7, лишние символы отсекаем. */
function initPhoneField(input: HTMLInputElement): void {
  if (!input.value.trim()) input.value = "+7";
  input.addEventListener("focus", () => {
    if (!input.value.trim()) input.value = "+7";
  });
  input.addEventListener("input", () => {
    const next = sanitizePhoneInput(input.value);
    if (input.value !== next) input.value = next;
  });
  input.addEventListener("blur", () => {
    input.value = sanitizePhoneInput(input.value || "+7");
  });
  input.addEventListener("keydown", (event) => {
    const digits = input.value.replace(/\D/g, "");
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      digits.length <= 1 &&
      (input.selectionStart ?? 0) <= 2
    ) {
      event.preventDefault();
      input.value = "+7";
    }
  });
}

function statusLabel(status: Booking["status"]): string {
  switch (status) {
    case "in_progress":
      return "В работе";
    case "done":
      return "Закрыта";
    case "cancelled":
      return "Отменена";
    default:
      return "Новая";
  }
}

function renderAppts(items = loadBookings()): void {
  const section = document.getElementById("appointments");
  const list = document.getElementById("appt-list");
  if (!section || !list) return;

  if (!items.length) {
    section.hidden = true;
    list.replaceChildren();
    return;
  }

  section.hidden = false;
  list.innerHTML = items
    .slice()
    .reverse()
    .map(
      (a) => `<li>
        <span><strong>${escapeHtml(formatBookingDate(a.date))} · ${escapeHtml(a.time)}</strong><br />${escapeHtml(a.brand)} ${escapeHtml(a.model)} — ${escapeHtml(a.service || kindTitle(a.kind))}<br /><em class="appt-status">${escapeHtml(statusLabel(a.status))}</em></span>
        <span class="appt-side">
          <span>${escapeHtml(a.name)}<br />${escapeHtml(a.phone)}</span>
          <button type="button" class="btn btn-ghost appt-remove" data-remove-id="${a.id}">Скрыть</button>
        </span>
      </li>`,
    )
    .join("");
}

async function syncAppts(): Promise<void> {
  const local = loadBookings();
  if (!local.length) {
    renderAppts([]);
    return;
  }

  try {
    const remote = await lookupBookings(local.map((item) => ({ id: item.id, phone: item.phone })));
    if (!remote.bookings.length) {
      const health = await fetchHealth().catch(() => null);
      if (health && !health.postgres) {
        renderAppts(local);
        return;
      }
    }
    const byId = new Map(remote.bookings.map((item) => [item.id, item]));
    const synced: Booking[] = [];
    for (const item of local) {
      const live = byId.get(item.id);
      if (!live) continue;
      synced.push({
        ...item,
        kind: live.kind,
        brand: live.brand,
        model: live.model,
        service: live.service,
        date: live.date,
        time: live.time,
        name: live.name,
        phone: live.phone,
        status: live.status,
        consent: true,
      });
    }

    saveBookings(synced);
    renderAppts(synced);
  } catch {
    // Если сервер недоступен — показываем локальный список, чтобы не пугать пустотой.
    renderAppts(local);
  }
}

function initAppts(): void {
  const list = document.getElementById("appt-list");
  if (!list) return;

  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-remove-id]");
    if (!(button instanceof HTMLButtonElement)) return;

    const id = Number(button.dataset.removeId);
    if (!Number.isFinite(id)) return;
    if (!window.confirm("Скрыть эту заявку из списка на этом устройстве?")) return;

    removeBooking(id);
    renderAppts();
  });
}

function initBookingForm(): void {
  const form = document.getElementById("book-form");
  if (!(form instanceof HTMLFormElement)) return;

  const timeSelect = form.elements.namedItem("time");
  const dateInput = form.elements.namedItem("date");
  const phoneInput = form.elements.namedItem("phone");
  if (
    !(timeSelect instanceof HTMLSelectElement) ||
    !(dateInput instanceof HTMLInputElement) ||
    !(phoneInput instanceof HTMLInputElement)
  ) {
    return;
  }

  const errorEl = qs<HTMLElement>("#form-error");
  const done = qs<HTMLDialogElement>("#done");
  const doneText = qs<HTMLElement>("#done-text");
  const consent = form.elements.namedItem("consent");
  const formOpenedAt = Date.now();

  fillTimes(timeSelect);
  initDateField(dateInput);
  initPhoneField(phoneInput);
  if (consent instanceof HTMLInputElement) consent.checked = false;

  const clearFieldError = () => {
    form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  };

  const showFieldError = (field: BookingField, message: string) => {
    clearFieldError();
    errorEl.textContent = message;
    errorEl.hidden = false;

    const control = form.elements.namedItem(field);
    const target =
      control instanceof RadioNodeList
        ? Array.from(control).find((el): el is HTMLElement => el instanceof HTMLElement)
        : control instanceof HTMLElement
          ? control
          : null;

    if (target) {
      target.classList.add("is-invalid");
      if ("focus" in target && typeof target.focus === "function") {
        target.focus();
      }
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  form.addEventListener("input", clearFieldError);
  form.addEventListener("change", clearFieldError);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    clearFieldError();

    const fd = new FormData(form);
    const honeypot = String(fd.get("company_url") || "").trim();
    if (honeypot) {
      errorEl.textContent = "Не удалось отправить заявку. Обновите страницу и попробуйте снова.";
      errorEl.hidden = false;
      return;
    }

    const data: BookingInput = {
      kind: String(fd.get("kind") ?? "repair"),
      brand: String(fd.get("brand") ?? ""),
      model: String(fd.get("model") ?? ""),
      mileage: String(fd.get("mileage") ?? ""),
      service: String(fd.get("service") ?? ""),
      date: String(fd.get("date") ?? ""),
      time: String(fd.get("time") ?? ""),
      name: String(fd.get("name") ?? ""),
      phone: sanitizePhoneInput(String(fd.get("phone") ?? "")),
      note: String(fd.get("note") ?? ""),
      consent: fd.get("consent") === "on",
    };

    const result = validateBooking(data);
    if (!result.ok) {
      showFieldError(result.field, result.message);
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const remote = await submitBooking({
        ...data,
        phone: formatPhoneStored(data.phone),
        date: result.date,
        formOpenedAt,
      });
      const items = loadBookings();
      items.push({
        ...data,
        date: result.date,
        id: remote.booking.id,
        status: remote.booking.status,
      });
      saveBookings(items);
      renderAppts(items);

      doneText.textContent = bookingDoneMessage({
        name: data.name,
        kind: data.kind,
        service: data.service,
        phone: data.phone,
      });
      if (typeof done.showModal === "function") done.showModal();
      form.reset();
      if (consent instanceof HTMLInputElement) consent.checked = false;
      const kindRepair = form.querySelector<HTMLInputElement>('input[name="kind"][value="repair"]');
      if (kindRepair) kindRepair.checked = true;
      fillTimes(timeSelect);
      phoneInput.value = "+7";
    } catch (error) {
      errorEl.textContent =
        error instanceof Error
          ? error.message
          : "Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.";
      errorEl.hidden = false;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function initLegalNav(): void {
  document.querySelectorAll("[data-open-cookies]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem(COOKIE_CONSENT_KEY);
      showBanner();
      const panel = document.getElementById("cookie-settings");
      if (panel) panel.hidden = false;
      applyMap(null);
    });
  });
}

function initServiceTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".service-tab[data-tab]")];
  if (tabs.length < 2) return;

  const activate = (key: string) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === key;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
      if (!panel) continue;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.tab || "general"));
  }

  // Deep-link: #service-special opens the special tab
  const openSpecial = location.hash === "#service-special" || location.hash === "#panel-special";
  if (openSpecial) activate("special");

  document.querySelectorAll('a[href="#service-special"]').forEach((link) => {
    link.addEventListener("click", () => activate("special"));
  });
}

initCookieBanner();
initBookingForm();
initAppts();
void syncAppts();
initLegalNav();
initServiceTabs();
initScrollUi();
initReveal(REVEAL_TARGETS);
