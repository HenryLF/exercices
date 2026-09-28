// Filter selects submit their form on change (the <noscript> button covers no-JS browsers).
document
  .querySelectorAll('select[data-autosubmit]')
  .forEach((el) => el.addEventListener('change', () => el.form?.submit()));
