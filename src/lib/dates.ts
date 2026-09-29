const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTime.format(d) : '';
}
