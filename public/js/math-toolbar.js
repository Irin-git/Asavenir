// ===============================
// math-toolbar.js — Barre d'outils d'insertion de formules mathématiques (Chantier 4)
// ===============================
// Utilisée uniquement côté admin, lors de la création d'une question, pour insérer
// des symboles mathématiques (LaTeX) sans que l'étudiant admin ait besoin de connaître LaTeX.

const SNIPPETS_MATH = [
  { label: 'a/b', latex: '\\frac{a}{b}' },
  { label: '√x', latex: '\\sqrt{x}' },
  { label: 'xⁿ', latex: 'x^{n}' },
  { label: 'xₙ', latex: 'x_{n}' },
  { label: 'Σ', latex: '\\sum_{i=1}^{n}' },
  { label: '∫', latex: '\\int_{a}^{b}' },
  { label: 'π', latex: '\\pi' },
  { label: '≤', latex: '\\leq' },
  { label: '≥', latex: '\\geq' },
  { label: '×', latex: '\\times' },
  { label: '÷', latex: '\\div' }
];

// Insère un texte à la position du curseur dans un textarea, puis replace le curseur juste après
function insererALaPosition(textarea, texte) {
  const debut = textarea.selectionStart;
  const fin = textarea.selectionEnd;
  const valeur = textarea.value;
  textarea.value = valeur.slice(0, debut) + texte + valeur.slice(fin);
  const nouvellePosition = debut + texte.length;
  textarea.focus();
  textarea.setSelectionRange(nouvellePosition, nouvellePosition);
}

// Construit la barre de boutons dans #toolbarId, branche l'aperçu live dans #previewId
function initMathToolbar(textareaId, toolbarId, previewId) {
  const textarea = document.getElementById(textareaId);
  const toolbar = document.getElementById(toolbarId);
  const preview = document.getElementById(previewId);
  if (!textarea || !toolbar) return;

  toolbar.innerHTML = SNIPPETS_MATH.map(s =>
    `<button type="button" class="btn btn-sm btn-outline-secondary me-1 mb-1">${s.label}</button>`
  ).join('');

  toolbar.querySelectorAll('button').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      insererALaPosition(textarea, `\\(${SNIPPETS_MATH[i].latex}\\)`);
      mettreAJourApercuMath(textarea, preview, previewId);
    });
  });

  textarea.addEventListener('input', () => mettreAJourApercuMath(textarea, preview, previewId));

  mettreAJourApercuMath(textarea, preview, previewId);
}

function mettreAJourApercuMath(textarea, preview, previewId) {
  if (!preview) return;
  preview.innerHTML = textarea.value || '<span class="text-muted">Aperçu du rendu final...</span>';
  rendreMathDans(`#${previewId}`);
}
