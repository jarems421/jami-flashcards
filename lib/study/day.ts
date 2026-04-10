const STUDY_TIME_ZONE = "Europe/London";
const STUDY_DAY_BOUNDARY_HOUR = 16;

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type StudyDayWindow = {
  studyDayKey: string;
  start: number;
  end: number;
};

const zonedDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: STUDY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getZonedDateParts(timestamp: number): ZonedDateParts {
  const parts = zonedDateFormatter.formatToParts(new Date(timestamp));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function formatDayKey(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function parseDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return { year, month, day };
}

function shiftCalendarDate(year: number, month: number, day: number, deltaDays: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDateTimeToUtcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = getZonedDateParts(guess);
    const diff =
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
      Date.UTC(year, month - 1, day, hour, minute, second);

    if (diff === 0) {
      return guess;
    }

    guess -= diff;
  }

  return guess;
}

export function getStudyDayKey(timestamp = Date.now()) {
  const parts = getZonedDateParts(timestamp);
  const boundaryDate =
    parts.hour >= STUDY_DAY_BOUNDARY_HOUR
      ? { year: parts.year, month: parts.month, day: parts.day }
      : shiftCalendarDate(parts.year, parts.month, parts.day, -1);

  return formatDayKey(boundaryDate.year, boundaryDate.month, boundaryDate.day);
}

export function shiftStudyDayKey(dayKey: string, deltaDays: number) {
  const { year, month, day } = parseDayKey(dayKey);
  const shifted = shiftCalendarDate(year, month, day, deltaDays);
  return formatDayKey(shifted.year, shifted.month, shifted.day);
}

export function getStudyDayStartFromKey(dayKey: string) {
  const { year, month, day } = parseDayKey(dayKey);
  return localDateTimeToUtcTimestamp(
    year,
    month,
    day,
    STUDY_DAY_BOUNDARY_HOUR
  );
}

export function getStudyDayWindow(timestamp = Date.now()): StudyDayWindow {
  const studyDayKey = getStudyDayKey(timestamp);
  const start = getStudyDayStartFromKey(studyDayKey);
  const end = getStudyDayStartFromKey(shiftStudyDayKey(studyDayKey, 1));

  return {
    studyDayKey,
    start,
    end,
  };
}

export function getMsUntilNextStudyBoundary(timestamp = Date.now()) {
  return Math.max(0, getStudyDayWindow(timestamp).end - timestamp);
}

export function isWithinStudyDayBoundaryWindow(
  timestamp = Date.now(),
  windowMs = 60 * 60 * 1000
) {
  const { start } = getStudyDayWindow(timestamp);
  return timestamp >= start && timestamp < start + windowMs;
}

export function formatStudyDayLabel(dayKey: string) {
  const { month, day } = parseDayKey(dayKey);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function getStudyTimeZone() {
  return STUDY_TIME_ZONE;
}

