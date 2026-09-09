import type { BookingInput } from "./validation";

export type BookingStatus = "new" | "in_progress" | "done" | "cancelled";

export type StaffUser = {
  login: string;
  name: string;
  role: "admin" | "operator";
};

export type RemoteBooking = {
  id: number;
  kind: string;
  brand: string;
  model: string;
  mileage: string;
  service: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  note: string;
  status: BookingStatus;
  assignee: string | null;
  returnReason?: string | null;
  returnedBy?: string | null;
  returnedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string | null;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Ошибка ${response.status}`);
  }
  return data;
}

export function submitBooking(
  data: BookingInput & { date: string },
): Promise<{ booking: RemoteBooking }> {
  return request("/api/bookings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type PublicBooking = {
  id: number;
  kind: string;
  brand: string;
  model: string;
  service: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  status: BookingStatus;
};

/** Сверяет локальные id+телефон с сервером: возвращает только живые заявки (не в корзине). */
export function lookupBookings(
  items: Array<{ id: number; phone: string }>,
): Promise<{ bookings: PublicBooking[] }> {
  return request("/api/bookings/lookup", {
    method: "POST",
    body: JSON.stringify({
      items: items.slice(0, 40).map((item) => ({
        id: item.id,
        phone: item.phone,
      })),
    }),
  });
}

export function login(
  loginName: string,
  password: string,
): Promise<{ token: string; user: StaffUser }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: loginName, password }),
  });
}

export function logout(token: string): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchMe(token: string): Promise<{ user: StaffUser }> {
  return request("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchBookings(token: string): Promise<{ bookings: RemoteBooking[] }> {
  return request("/api/bookings", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateBooking(
  token: string,
  id: number,
  body: { status?: BookingStatus; take?: boolean; returnReason?: string },
): Promise<{ booking: RemoteBooking }> {
  return request(`/api/bookings/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function deleteBooking(token: string, id: number): Promise<{ booking: RemoteBooking }> {
  return request(`/api/bookings/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchTrash(token: string): Promise<{ bookings: RemoteBooking[] }> {
  return request("/api/bookings/trash", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function restoreBooking(token: string, id: number): Promise<{ booking: RemoteBooking }> {
  return request(`/api/bookings/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function purgeBooking(token: string, id: number): Promise<{ ok: boolean }> {
  return request(`/api/bookings/${id}/permanent`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function emptyTrash(token: string): Promise<{ ok: boolean; removed: number }> {
  return request("/api/bookings/trash", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchStaff(token: string): Promise<{ users: StaffUser[] }> {
  return request("/api/staff", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createStaff(
  token: string,
  body: { login: string; password: string; name: string },
): Promise<{ user: StaffUser }> {
  return request("/api/staff", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function downloadBackup(token: string): Promise<void> {
  const response = await fetch("/api/backup/download", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Ошибка ${response.status}`);
  }
  const blob = await response.blob();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tls-bookings-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function restoreBackup(
  token: string,
  payload: { bookings: RemoteBooking[]; nextBookingId?: number },
): Promise<{ ok: boolean; restored: number }> {
  return request("/api/backup/restore", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}
