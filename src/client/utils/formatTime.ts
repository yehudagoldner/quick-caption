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

