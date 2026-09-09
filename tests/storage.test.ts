import { describe, expect, it } from "vitest";
import { BOOKING_STORAGE_KEY } from "../src/operator";
import { loadBookings, removeBooking, saveBookings } from "../src/storage";
import type { Booking } from "../src/validation";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    key() {
      return null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

function sample(id: number): Booking {
  return {
    id,
    kind: "repair",
    brand: "Toyota",
    model: "Camry",
    service: "",
    date: "2026-09-24",
    time: "11:00",
    name: "Иван",
    phone: "+79013720312",
    consent: true,
  };
}

describe("bookings storage", () => {
  it("удаляет заявку по id и оставляет остальные", () => {
    const storage = memoryStorage();
    saveBookings([sample(1), sample(2), sample(3)], storage);
    const left = removeBooking(2, storage);
    expect(left.map((item) => item.id)).toEqual([1, 3]);
    expect(loadBookings(storage).map((item) => item.id)).toEqual([1, 3]);
    expect(storage.getItem(BOOKING_STORAGE_KEY)).toContain('"id":1');
  });

  it("не падает, если такой заявки уже нет", () => {
    const storage = memoryStorage();
    saveBookings([sample(1)], storage);
    expect(removeBooking(99, storage)).toHaveLength(1);
  });
});
