/**
 * Generate an .ics (iCalendar) file and trigger download / share
 * This allows users to add reminders to their system calendar
 */

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function generateUID(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}@baby-log`;
}

interface CalendarEvent {
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  alarmMinutesBefore?: number;
}

function generateICS(event: CalendarEvent): string {
  const start = formatICSDate(event.startDate);
  const end = formatICSDate(event.endDate || new Date(event.startDate.getTime() + 15 * 60000));
  const alarm = event.alarmMinutesBefore ?? 0;

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BabyLog//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${generateUID()}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description || ''}`,
    'STATUS:CONFIRMED',
  ];

  if (alarm >= 0) {
    ics.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${event.title}`,
      alarm === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-PT${alarm}M`,
      'END:VALARM'
    );
  }

  ics.push('END:VEVENT', 'END:VCALENDAR');
  return ics.join('\r\n');
}

export function downloadICS(event: CalendarEvent) {
  const icsContent = generateICS(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // Try to use share API on mobile for a better experience
  if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'reminder.ics', { type: 'text/calendar' })] })) {
    navigator.share({
      files: [new File([blob], 'reminder.ics', { type: 'text/calendar' })],
      title: event.title,
    }).catch(() => {
      // Fallback to download
      triggerDownload(url, 'reminder.ics');
    });
  } else {
    triggerDownload(url, 'reminder.ics');
  }
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function addFeedingReminderToCalendar(minutesUntilNext: number) {
  const targetDate = new Date(Date.now() + minutesUntilNext * 60000);
  const hours = targetDate.getHours();
  const minutes = targetDate.getMinutes();

  // On Android, try to open the system alarm clock
  const isAndroid = /android/i.test(navigator.userAgent);
  if (isAndroid) {
    const intentUrl = `intent://set?hour=${hours}&minutes=${minutes}&message=${encodeURIComponent('🍼 宝宝喂奶时间到!')}#Intent;action=android.intent.action.SET_ALARM;end`;
    const opened = tryOpenUrl(intentUrl);
    if (opened) return;
  }

  // Fallback: generate .ics with alarm trigger at event time
  downloadICS({
    title: '🍼 宝宝喂奶时间到!',
    description: '根据喂养规律，宝宝预计需要喂奶了',
    startDate: targetDate,
    endDate: new Date(targetDate.getTime() + 60000),
    alarmMinutesBefore: 0,
  });
}

function tryOpenUrl(url: string): boolean {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

export function addPlanToCalendar(title: string, scheduledAt: string, description?: string, reminderMinutes?: number) {
  downloadICS({
    title,
    description,
    startDate: new Date(scheduledAt),
    alarmMinutesBefore: reminderMinutes || 30,
  });
}
