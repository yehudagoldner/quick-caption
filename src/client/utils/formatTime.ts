export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) {
    return "—";
  }

  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) {
    return "—";
  }

  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatTime(seconds: number) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "00:00";
  }

  const totalMillis = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMillis / 60000);
  const remainingMillis = totalMillis % 60000;
  const secs = Math.floor(remainingMillis / 1000);
  const hundredths = Math.floor((remainingMillis % 1000) / 10);

  const base = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (hundredths === 0) {
    return base;
  }
  return `${base}.${String(hundredths).padStart(2, "0")}`;
}

