// ===============================
// math-render.js — Rendu des formules mathématiques (Chantier 4)
// ===============================
// Convertit les délimiteurs LaTeX présents dans le texte d'un énoncé en formule
// mathématique lisible, via la librairie KaTeX (chargée en CDN dans chaque page concernée).
// Délimiteurs acceptés : \( ... \) pour une formule en ligne, \[ ... \] pour une formule isolée.
//
// Utilisation : après avoir inséré un énoncé dans le DOM (innerHTML), appeler
// rendreMathDans('#idDuConteneur') pour transformer les formules qu'il contient.

function rendreMathDans(cible) {
  // Si KaTeX n'a pas pu se charger (ex: pas de connexion internet), on n'affiche pas
  // d'erreur au candidat : le texte brut avec \( \) reste lisible, juste moins joli.
  if (typeof renderMathInElement === 'undefined') return;

  // Accepte soit un sélecteur CSS ('#monId'), soit directement un élément DOM
  const elements = typeof cible === 'string' ? document.querySelectorAll(cible) : [cible];

  elements.forEach(el => {
    if (!el) return;
    renderMathInElement(el, {
      delimiters: [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false
    });
  });
}
