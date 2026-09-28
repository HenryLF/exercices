// Exercise page: after an answer the server redirects to #<next question>; bring its field into
// view and focus it (Android opens the keyboard; iOS only scrolls). A double tap on "Valider"
// must not send the same answer twice.
(() => {
  const row = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  const field = row?.querySelector('form.answer input, form.answer select');
  if (field && !field.disabled) field.focus({ preventScroll: true });

  document.querySelectorAll('form.answer, form.tip-form').forEach((form) =>
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      // Disabled after the browser has read the form, so the value is still sent.
      if (button) setTimeout(() => (button.disabled = true));
    }),
  );
})();
