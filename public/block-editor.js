// Exercise editor: add, remove and reorder block rows, and show the fields of each row's type.
// Row inputs are named blocks[i][field]; indexes are rewritten before submit so they stay dense.
(() => {
  const list = document.getElementById('blocks');
  const template = document.getElementById('block-template');
  const form = document.getElementById('block-form');
  if (!list || !template || !form) return;
  document.documentElement.classList.add('js');

  const sync = (row) => {
    const type = row.querySelector('.b-type');
    const answer = row.querySelector('.b-answer');
    row.dataset.type = type ? type.value : 'question';
    row.dataset.answer = answer ? answer.value : 'number';
  };

  const renumber = () => {
    [...list.children].forEach((row, i) => {
      row.querySelectorAll('[name^="blocks["]').forEach((el) => {
        el.name = el.name.replace(/^blocks\[[^\]]*\]/, `blocks[${i}]`);
      });
      const num = row.querySelector('.q-num');
      if (num) num.textContent = String(i + 1);
    });
  };

  list.querySelectorAll('fieldset.block').forEach(sync);

  document.getElementById('add-block')?.addEventListener('click', () => {
    const row = template.content.firstElementChild.cloneNode(true);
    list.append(row);
    sync(row);
    renumber();
    row.querySelector('select')?.focus();
  });

  list.addEventListener('change', (e) => {
    if (e.target.classList?.contains('b-type') || e.target.classList?.contains('b-answer'))
      sync(e.target.closest('fieldset'));
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const row = btn?.closest('fieldset.block');
    if (!btn || !row) return;
    if (btn.classList.contains('q-remove')) row.remove();
    else if (btn.classList.contains('q-up') && row.previousElementSibling)
      row.previousElementSibling.before(row);
    else if (btn.classList.contains('q-down') && row.nextElementSibling)
      row.nextElementSibling.after(row);
    else return;
    renumber();
  });

  form.addEventListener('submit', renumber);
})();
