// The CSV is read here, in the browser: the file input has no name, so the file itself is never
// uploaded. Only the logins computed from it are posted, as JSON in the hidden `payload` field.
import { readExport } from './import-csv.js';

const MAX_BYTES = 2 * 1024 * 1024;
const form = document.getElementById('import-form');
const file = document.getElementById('import-file');
const payload = document.getElementById('import-payload');
const error = document.getElementById('import-error');

function fail(message) {
  error.textContent = message;
  error.hidden = false;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const chosen = file.files?.[0];
  if (!chosen || chosen.size === 0) return fail('Choisissez un fichier CSV.');
  if (chosen.size > MAX_BYTES) return fail('Le fichier dépasse 2 Mo.');
  const parsed = readExport(await chosen.text());
  if (parsed.fatal) return fail(parsed.fatal);
  payload.value = JSON.stringify(parsed);
  form.submit();
});
