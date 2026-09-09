import { BOOKING_STORAGE_KEY } from "./operator";
import type { Booking } from "./validation";

export function loadBookings(storage: Storage = localStorage): Booking[] {
  try {
    const raw = storage.getItem(BOOKING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Booking[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookings(items: Booking[], storage: Storage = localStorage): void {
  storage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(items));
}

/** Удаляет одну заявку по id. Возвращает оставшиеся. */
export function removeBooking(id: number, storage: Storage = localStorage): Booking[] {
  const next = loadBookings(storage).filter((item) => item.id !== id);
  saveBookings(next, storage);
  return next;
}
