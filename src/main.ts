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
import { lookupBookings, submitBooking } from "./api";
import { loadBookings, removeBooking, saveBookings } from "./storage";
import {
  SLOTS,
  bookingDoneMessage,
  formatBookingDate,
  formatDayMonth,
  kindTitle,
  parseBookingDate,
  sanitizeDateInput,
  validateBooking,
  type Booking,
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

/** Дата — ровно 4 цифры ДДММ; лишнее и буквы отсекаем при вводе. */
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
    const remote = await lookupBookings(
      local.map((item) => ({ id: item.id, phone: item.phone })),
    );
    const byId = new Map(remote.bookings.map((item) => [item.id, item]));
    const synced: Booking[] = local
      .map((item) => {
        const live = byId.get(item.id);
        if (!live) return null;
        return {
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
        };
      })
      .filter((item): item is Booking => item != null);

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
  if (!(timeSelect instanceof HTMLSelectElement) || !(dateInput instanceof HTMLInputElement)) {
    return;
  }

  const errorEl = qs<HTMLElement>("#form-error");
  const done = qs<HTMLDialogElement>("#done");
  const doneText = qs<HTMLElement>("#done-text");
  const consent = form.elements.namedItem("consent");

  fillTimes(timeSelect);
  initDateField(dateInput);
  if (consent instanceof HTMLInputElement) consent.checked = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const fd = new FormData(form);
    const data: BookingInput = {
      kind: String(fd.get("kind") ?? "repair"),
      brand: String(fd.get("brand") ?? ""),
      model: String(fd.get("model") ?? ""),
      mileage: String(fd.get("mileage") ?? ""),
      service: String(fd.get("service") ?? ""),
      date: String(fd.get("date") ?? ""),
      time: String(fd.get("time") ?? ""),
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      note: String(fd.get("note") ?? ""),
      consent: fd.get("consent") === "on",
    };

    const result = validateBooking(data);
    if (!result.ok) {
      errorEl.textContent = result.message;
      errorEl.hidden = false;
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const remote = await submitBooking({ ...data, date: result.date });
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

initCookieBanner();
initBookingForm();
initAppts();
void syncAppts();
initLegalNav();
initScrollUi();
initReveal(REVEAL_TARGETS);
