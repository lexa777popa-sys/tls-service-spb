import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/chakra-petch/latin-700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";

import {
  createStaff,
  deleteBooking,
  emptyTrash,
  fetchBookings,
  fetchMe,
  fetchStaff,
  fetchTrash,
  login as apiLogin,
  logout as apiLogout,
  purgeBooking,
  restoreBooking,
  updateBooking,
  type BookingStatus,
  type RemoteBooking,
  type StaffUser,
} from "./api";
import { formatBookingDate, kindTitle } from "./validation";
import "./style.css";
import "./admin.css";

const TOKEN_KEY = "tls-staff-token";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const appError = document.getElementById("app-error");
const whoami = document.getElementById("whoami");
const bookingList = document.getElementById("booking-list");
const emptyState = document.getElementById("empty-state");
const trashToolbar = document.getElementById("trash-toolbar");
const staffSection = document.getElementById("staff-panel");
const staffForm = document.getElementById("staff-form");
const staffError = document.getElementById("staff-error");
const staffList = document.getElementById("staff-list");
const returnDialog = document.getElementById("return-reason-dialog") as HTMLDialogElement | null;
const returnForm = document.getElementById("return-reason-form") as HTMLFormElement | null;
const returnError = document.getElementById("return-reason-error");
const returnCancel = document.getElementById("return-reason-cancel");

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser: StaffUser | null = null;
let bookings: RemoteBooking[] = [];
let trash: RemoteBooking[] = [];
let returnReasonResolver: ((value: string | null) => void) | null = null;
let filter: "all" | "trash" | BookingStatus = "all";
let liveSource: EventSource | null = null;
let pollTimer: number | null = null;
let lastSignature = "";
let refreshing = false;

function showError(el: HTMLElement | null, message: string): void {
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusLabel(status: BookingStatus): string {
  const map: Record<BookingStatus, string> = {
    new: "Новая",
    in_progress: "В работе",
    done: "Закрыта",
    cancelled: "Отменена",
  };
  return map[status];
}

function setAuthed(user: StaffUser): void {
  currentUser = user;
  if (loginView) loginView.hidden = true;
  if (appView) appView.hidden = false;
  if (whoami) whoami.textContent = `${user.name} · ${user.login}`;
  if (staffSection) staffSection.hidden = user.role !== "admin";
}

function setGuest(): void {
  stopLiveUpdates();
  currentUser = null;
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  if (loginView) loginView.hidden = false;
  if (appView) appView.hidden = true;
}

function queueSignature(active: RemoteBooking[], trashed: RemoteBooking[]): string {
  const pack = (list: RemoteBooking[]) =>
    list
      .map(
        (item) =>
          [
            item.id,
            item.status,
            item.updatedAt,
            item.trashedAt || "",
            item.assignee || "",
            item.returnReason || "",
          ].join(":"),
      )
      .join(",");
  return `${pack(active)}#${pack(trashed)}`;
}

async function refreshBookings(silent = false): Promise<void> {
  if (!token || refreshing) return;
  refreshing = true;
  try {
    const [active, trashed] = await Promise.all([fetchBookings(token), fetchTrash(token)]);
    const next = queueSignature(active.bookings, trashed.bookings);
    bookings = active.bookings;
    trash = trashed.bookings;
    if (next !== lastSignature) {
      lastSignature = next;
      renderBookings();
    }
  } catch (error) {
    if (!silent) throw error;
  } finally {
    refreshing = false;
  }
}

function stopLiveUpdates(): void {
  liveSource?.close();
  liveSource = null;
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startLiveUpdates(): void {
  stopLiveUpdates();
  if (!token) return;

  const source = new EventSource(`/api/bookings/stream?token=${encodeURIComponent(token)}`);
  source.addEventListener("bookings", () => {
    void refreshBookings(true);
  });
  liveSource = source;

  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void refreshBookings(true);
  }, 5000);
}

async function refreshStaff(): Promise<void> {
  if (!token || currentUser?.role !== "admin" || !staffList) return;
  const data = await fetchStaff(token);
  staffList.innerHTML = data.users
    .map(
      (person) => `<li>
        <span>
          <strong>${escapeHtml(person.name)}</strong>
          <em>${escapeHtml(person.login)} · ${person.role === "admin" ? "админ" : "оператор"}</em>
        </span>
      </li>`,
    )
    .join("");
}

function askReturnReason(): Promise<string | null> {
  if (!returnDialog || !returnForm) {
    const typed = window.prompt("Почему возвращаете заявку в новые?");
    const reason = typed?.trim() || "";
    return Promise.resolve(reason.length >= 5 ? reason : null);
  }

  returnForm.reset();
  showError(returnError, "");
  returnDialog.showModal();

  return new Promise((resolve) => {
    returnReasonResolver = resolve;
  });
}

function finishReturnReason(reason: string | null): void {
  returnDialog?.close();
  const resolve = returnReasonResolver;
  returnReasonResolver = null;
  resolve?.(reason);
}

function renderBookings(): void {
  if (!bookingList) return;
  const inTrash = filter === "trash";
  if (trashToolbar) trashToolbar.hidden = !inTrash;

  const items = inTrash
    ? trash
    : bookings.filter((item) => (filter === "all" ? true : item.status === filter));

  if (emptyState) {
    emptyState.hidden = items.length > 0;
    emptyState.textContent = inTrash ? "Корзина пуста." : "Заявок пока нет.";
  }

  if (!items.length) {
    bookingList.replaceChildren();
    return;
  }

  bookingList.innerHTML = items
    .map((item) => {
      const direction = kindTitle(item.kind);
      const service = item.service.trim() || "Не указана — уточнить при звонке";
      const assignee = item.assignee ? ` · ${escapeHtml(item.assignee)}` : "";
      const actions = inTrash
        ? [
            `<button type="button" class="btn btn-accent" data-restore="${item.id}">Вернуть</button>`,
            `<button type="button" class="btn btn-ghost" data-purge="${item.id}">Удалить навсегда</button>`,
          ].join("")
        : [
            item.status === "new"
              ? `<button type="button" class="btn btn-accent" data-take="${item.id}">Взять в работу</button>`
              : "",
            item.status === "in_progress"
              ? `<button type="button" class="btn btn-accent" data-status="${item.id}" data-next="done">Закрыть</button>`
              : "",
            item.status === "new" || item.status === "in_progress"
              ? `<button type="button" class="btn btn-ghost" data-status="${item.id}" data-next="cancelled">Отменить</button>`
              : "",
            item.status === "done" || item.status === "cancelled"
              ? `<button type="button" class="btn btn-ghost" data-status="${item.id}" data-next="new">Вернуть в новые</button>`
              : "",
            `<button type="button" class="btn btn-ghost" data-delete="${item.id}">В корзину</button>`,
          ]
            .filter(Boolean)
            .join("");

      const when = inTrash && item.trashedAt ? item.trashedAt : item.createdAt;

      return `<li class="booking-card status-${item.status}">
        <article>
          <header>
            <span class="status-pill">${inTrash ? "В корзине" : statusLabel(item.status)}${assignee}</span>
            <time>${escapeHtml(new Date(when).toLocaleString("ru-RU"))}</time>
          </header>
          <h2>${escapeHtml(item.brand)} ${escapeHtml(item.model)}</h2>
          <dl>
            <div><dt>Направление</dt><dd>${escapeHtml(direction)}</dd></div>
            <div><dt>Услуга</dt><dd>${escapeHtml(service)}</dd></div>
            <div><dt>Когда</dt><dd>${escapeHtml(formatBookingDate(item.date))} · ${escapeHtml(item.time)}</dd></div>
            <div><dt>Клиент</dt><dd>${escapeHtml(item.name)} · <a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a></dd></div>
            ${item.mileage ? `<div><dt>Пробег</dt><dd>${escapeHtml(item.mileage)} км</dd></div>` : ""}
            ${item.note ? `<div><dt>Комментарий</dt><dd>${escapeHtml(item.note)}</dd></div>` : ""}
            ${
              item.returnReason
                ? `<div><dt>Причина возврата</dt><dd>${escapeHtml(item.returnReason)}${
                    item.returnedBy
                      ? ` <em>(${escapeHtml(item.returnedBy)}${
                          item.returnedAt
                            ? `, ${escapeHtml(new Date(item.returnedAt).toLocaleString("ru-RU"))}`
                            : ""
                        })</em>`
                      : ""
                  }</dd></div>`
                : ""
            }
          </dl>
          <div class="booking-actions">${actions}</div>
        </article>
      </li>`;
    })
    .join("");
}

async function boot(): Promise<void> {
  if (!token) {
    setGuest();
    return;
  }
  try {
    const me = await fetchMe(token);
    setAuthed(me.user);
    await refreshBookings();
    await refreshStaff();
    startLiveUpdates();
  } catch {
    setGuest();
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(loginError, "");
  const fd = new FormData(loginForm as HTMLFormElement);
  try {
    const result = await apiLogin(String(fd.get("login") || ""), String(fd.get("password") || ""));
    token = result.token;
    localStorage.setItem(TOKEN_KEY, token);
    setAuthed(result.user);
    await refreshBookings();
    await refreshStaff();
    startLiveUpdates();
    (loginForm as HTMLFormElement).reset();
  } catch (error) {
    showError(loginError, error instanceof Error ? error.message : "Ошибка входа");
  }
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  stopLiveUpdates();
  try {
    if (token) await apiLogout(token);
  } catch {
    /* ignore */
  }
  setGuest();
});

document.getElementById("refresh-btn")?.addEventListener("click", async () => {
  showError(appError, "");
  try {
    await refreshBookings();
    await refreshStaff();
  } catch (error) {
    showError(appError, error instanceof Error ? error.message : "Не удалось обновить");
  }
});

document.getElementById("empty-trash-btn")?.addEventListener("click", async () => {
  showError(appError, "");
  if (!window.confirm("Очистить корзину полностью? Заявки удалятся навсегда.")) return;
  try {
    await emptyTrash(token);
    await refreshBookings();
  } catch (error) {
    showError(appError, error instanceof Error ? error.message : "Не удалось очистить");
  }
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((el) => el.classList.remove("is-active"));
    button.classList.add("is-active");
    filter = (button.getAttribute("data-filter") || "all") as typeof filter;
    renderBookings();
  });
});

bookingList?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  showError(appError, "");
  try {
    const take = target.closest("[data-take]");
    if (take instanceof HTMLElement) {
      await updateBooking(token, Number(take.getAttribute("data-take")), { take: true });
      await refreshBookings();
      return;
    }
    const statusBtn = target.closest("[data-status]");
    if (statusBtn instanceof HTMLElement) {
      const next = statusBtn.getAttribute("data-next") as BookingStatus;
      const id = Number(statusBtn.getAttribute("data-status"));
      if (next === "new") {
        const reason = await askReturnReason();
        if (!reason) {
          showError(appError, "Чтобы вернуть заявку в новые, нужно написать причину");
          return;
        }
        await updateBooking(token, id, { status: next, returnReason: reason });
      } else {
        await updateBooking(token, id, { status: next });
      }
      await refreshBookings();
      return;
    }
    const deleteBtn = target.closest("[data-delete]");
    if (deleteBtn instanceof HTMLElement) {
      await deleteBooking(token, Number(deleteBtn.getAttribute("data-delete")));
      await refreshBookings();
      return;
    }
    const restoreBtn = target.closest("[data-restore]");
    if (restoreBtn instanceof HTMLElement) {
      await restoreBooking(token, Number(restoreBtn.getAttribute("data-restore")));
      await refreshBookings();
      return;
    }
    const purgeBtn = target.closest("[data-purge]");
    if (purgeBtn instanceof HTMLElement) {
      if (!window.confirm("Удалить эту заявку навсегда?")) return;
      await purgeBooking(token, Number(purgeBtn.getAttribute("data-purge")));
      await refreshBookings();
    }
  } catch (error) {
    showError(appError, error instanceof Error ? error.message : "Ошибка обновления");
  }
});

staffForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(staffError, "");
  const fd = new FormData(staffForm as HTMLFormElement);
  try {
    await createStaff(token, {
      name: String(fd.get("name") || ""),
      login: String(fd.get("login") || ""),
      password: String(fd.get("password") || ""),
    });
    (staffForm as HTMLFormElement).reset();
    await refreshStaff();
  } catch (error) {
    showError(staffError, error instanceof Error ? error.message : "Не удалось создать");
  }
});

returnForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const fd = new FormData(returnForm);
  const reason = String(fd.get("reason") || "").trim();
  if (reason.length < 5) {
    showError(returnError, "Напишите причину подробнее (минимум 5 символов)");
    return;
  }
  finishReturnReason(reason);
});

returnCancel?.addEventListener("click", () => {
  finishReturnReason(null);
});

returnDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishReturnReason(null);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && token && currentUser) {
    void refreshBookings(true);
  }
});

void boot();
