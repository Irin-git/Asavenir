// ===============================
// jury.js — Espace de correction (rôle jury)
// ===============================
// Ce fichier permet à un membre du jury de :
// 0. examiner les candidatures reçues et donner un avis consultatif (favorable/défavorable)
// 1. choisir un concours puis une épreuve déjà approuvée
// 2. corriger les copies une par une, de façon anonyme (juste un numéro de copie, pas de nom)

const API = '/concours_fp/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Garde d'accès : seul un compte "jury" connecté peut voir cette page
if (!token || user.role !== 'jury') {
  window.location.href = 'login.html';
}

document.getElementById('nomJury').textContent = user.nom || 'Jury';

function deconnexion() {
  localStorage.clear();
  window.location.href = 'login.html';
}

// ===== Petite bibliothèque d'icônes SVG inline (aucun emoji dans l'interface) =====
const svgIcons = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};

function showAlertJury(msg, type = 'danger') {
  const cls = type === 'success' ? 'alert-jury-success' : 'alert-jury-danger';
  const icon = type === 'success' ? svgIcons.check : svgIcons.warning;
  document.getElementById('alertMsgJury').innerHTML =
    `<div class="alert-jury-box ${cls}"><span style="width:16px;height:16px;flex-shrink:0;">${icon}</span>${msg}</div>`;
}

// Petite protection contre l'injection HTML dans les noms/titres affichés
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ===== Bandeau des affectations du jury connecté (dossiers de candidature) =====
async function chargerAffectationsJury() {
  const zone = document.getElementById('bandeauAffectationsJury');
  try {
    const res = await fetch(`${API}/affectations`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      zone.innerHTML = `<p class="text-danger">${data.message || 'Erreur de chargement des affectations.'}</p>`;
      return;
    }

    if (!data.length) {
      zone.innerHTML = `<div class="alert-jury-box alert-jury-danger">${svgIcons.warning} Aucune affectation pour le moment. Contactez l'administrateur.</div>`;
      return;
    }

    zone.innerHTML = `
      <div class="affectations-tags">
        ${data.map(a => `<span class="badge-avis badge-favorable">${svgIcons.check} ${escapeHtml(a.concours_titre)}</span>`).join(' ')}
      </div>
    `;
  } catch {
    zone.innerHTML = '<p class="text-danger">Erreur réseau lors du chargement des affectations.</p>';
  }
}

// ============================================
// ===== Candidatures à examiner (nouveau) =====
// ============================================

// Traduit la valeur technique de l'avis en badge lisible pour le jury
function badgeAvis(avis) {
  if (avis === 'favorable') return `<span class="badge-avis badge-favorable">${svgIcons.check} Favorable</span>`;
  if (avis === 'defavorable') return `<span class="badge-avis badge-defavorable">${svgIcons.cross} Défavorable</span>`;
  return '<span class="badge-avis badge-attente">En attente</span>';
}

async function chargerCandidaturesJury() {
  try {
    const res = await fetch(`${API}/candidatures?all=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('tableauCandidaturesJury').innerHTML =
        `<tr><td colspan="6" class="text-danger text-center py-3">${data.message || 'Erreur de chargement.'}</td></tr>`;
      return;
    }

    if (!data.length) {
      document.getElementById('tableauCandidaturesJury').innerHTML =
        '<tr><td colspan="6" class="text-center text-muted py-4">Aucune candidature à examiner pour le moment.</td></tr>';
      return;
    }

    document.getElementById('tableauCandidaturesJury').innerHTML = data.map(c => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.candidat_nom)}</td>
        <td>${escapeHtml(c.concours_titre)}</td>
        <td>${new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
        <td>${badgeAvis(c.avis_jury)}</td>
        <td>
          <a href="dossier.html?id=${c.id}&nom=${encodeURIComponent(c.candidat_nom)}"
             target="_blank" class="btn-action-jury btn-voir">${svgIcons.eye} Dossier</a>
          <button class="btn-action-jury btn-favorable" onclick="donnerAvisCandidature(${c.id}, 'favorable')">${svgIcons.check} Favorable</button>
          <button class="btn-action-jury btn-defavorable" onclick="donnerAvisCandidature(${c.id}, 'defavorable')">${svgIcons.cross} Défavorable</button>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('tableauCandidaturesJury').innerHTML =
      '<tr><td colspan="6" class="text-danger text-center py-3">Erreur de chargement.</td></tr>';
  }
}

// L'avis du jury est consultatif : il n'efface jamais le statut final, géré uniquement par l'admin
async function donnerAvisCandidature(id, avis_jury) {
  try {
    const res = await fetch(`${API}/candidatures`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id, avis_jury })
    });

    if (res.ok) {
      chargerCandidaturesJury();
    } else {
      alert('Erreur lors de l\'enregistrement de l\'avis');
    }
  } catch {
    alert('Erreur réseau');
  }
}

// ============================================
// ===== Correction des copies (inchangé) =====
// ============================================

// ===== CORRIGÉ : Chargement des concours =====
// Avant : appelait /concours (route générale, TOUS les concours de la plateforme).
// Un jury voyait donc des concours où il n'a aucune épreuve affectée, d'où le message
// trompeur "Aucune épreuve approuvée" au lieu d'un message clair d'absence d'affectation.
// Maintenant : appelle /epreuves?mes_concours_jury=1, qui ne renvoie que les concours
// où le jury a au moins une épreuve qui lui est explicitement affectée.
async function chargerConcoursJury() {
  const select = document.getElementById('selectConcoursJury');
  try {
    const res = await fetch(`${API}/epreuves?mes_concours_jury=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      select.innerHTML = `<option value="">${escapeHtml(data.message || 'Erreur de chargement')}</option>`;
      return;
    }

    if (!data.length) {
      select.innerHTML = '<option value="">Aucun concours affecté</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Choisir un concours --</option>';
    data.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${escapeHtml(c.titre)}</option>`;
    });
  } catch {
    select.innerHTML = '<option value="">Erreur réseau</option>';
  }
}

// ===== Chargement des épreuves approuvées du concours choisi =====
async function chargerEpreuvesJury() {
  const concours_id = document.getElementById('selectConcoursJury').value;
  const selectEpreuve = document.getElementById('selectEpreuveJury');
  document.getElementById('zoneReponsesJury').innerHTML = '';
  document.getElementById('progressCopiesJury').innerHTML = '';

  // On repart de zéro sur la liste des copies dès qu'on change de concours
  copiesJury = [];
  indexCopieJury = 0;

  if (!concours_id) {
    selectEpreuve.innerHTML = '<option value="">Sélectionnez d\'abord un concours</option>';
    return;
  }

  const res = await fetch(`${API}/epreuves?concours_id=${concours_id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();

  // Seules les épreuves déjà validées par l'admin peuvent être corrigées par le jury
  const approuvees = data.filter(e => e.statut_validation === 'approuvé');

  if (approuvees.length === 0) {
    selectEpreuve.innerHTML = '<option value="">Aucune épreuve approuvée</option>';
    return;
  }

  selectEpreuve.innerHTML = '<option value="">-- Choisir une épreuve --</option>';
  approuvees.forEach(e => {
    selectEpreuve.innerHTML += `<option value="${e.id}">${escapeHtml(e.titre)} (coeff. ${e.coefficient})</option>`;
  });
}

// ===== Gestion des copies (regroupement par candidature) =====
let copiesJury = [];      // liste des copies restantes à corriger
let indexCopieJury = 0;   // compteur pour afficher "Copie #1", "Copie #2", etc.
let totalCopiesJury = 0;  // total de départ, utilisé uniquement pour la jauge de progression (affichage)

// ===== Chargement des réponses à corriger, regroupées par copie =====
async function chargerReponsesJury() {
  const epreuve_id = document.getElementById('selectEpreuveJury').value;
  const zone = document.getElementById('zoneReponsesJury');
  zone.innerHTML = '';
  document.getElementById('alertMsgJury').innerHTML = '';

  if (!epreuve_id) return;

  const res = await fetch(`${API}/resultats?a_corriger=1&epreuve_id=${epreuve_id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();

  if (!res.ok) {
    showAlertJury(data.message || 'Erreur lors du chargement.');
    return;
  }

  // On regroupe toutes les réponses par candidature_id : chaque groupe = une copie complète
  const groupes = {};
  data.forEach(r => {
    if (!groupes[r.candidature_id]) groupes[r.candidature_id] = [];
    groupes[r.candidature_id].push(r);
  });

  copiesJury = Object.keys(groupes).map(cid => ({
    candidature_id: cid,
    reponses: groupes[cid]
  }));
  indexCopieJury = 0;
  totalCopiesJury = copiesJury.length;

  afficherCopieCourante();
}

// ===== Jauge de progression — purement visuel, ne touche à aucune donnée =====
function afficherProgressionJury() {
  const zone = document.getElementById('progressCopiesJury');
  if (!zone) return;

  if (totalCopiesJury === 0) {
    zone.innerHTML = '';
    return;
  }

  const corrigees = totalCopiesJury - copiesJury.length;
  const pourcentage = Math.round((corrigees / totalCopiesJury) * 100);

  zone.innerHTML = `
    <div class="progress-copies">
      ${svgIcons.clock}
      <div class="track"><div class="fill" style="width:${pourcentage}%"></div></div>
      <span class="count">${corrigees} / ${totalCopiesJury} copies corrigées</span>
    </div>
  `;
}

// ===== Affiche une seule copie à la fois (jamais toutes en même temps) =====
// Ça évite au correcteur de se mélanger entre plusieurs copies ouvertes en même temps
function afficherCopieCourante() {
  const zone = document.getElementById('zoneReponsesJury');
  afficherProgressionJury();

  if (copiesJury.length === 0) {
    zone.innerHTML = `<div class="alert-info-jury">${svgIcons.check} Toutes les copies de cette épreuve sont corrigées</div>`;
    return;
  }

  const copie = copiesJury[0]; // on prend toujours la première copie restante dans la liste
  indexCopieJury++;

  const questionsHtml = copie.reponses.map(r => `
    <div class="question-block">
      <p class="question-label">Question</p>
      <p class="mb-2">${r.enonce}</p>
      <p class="question-label">Réponse du candidat</p>
      <p class="reponse-text mb-2">${r.texte_reponse}</p>
      <label class="form-label-jury">Note (sur ${r.bareme})</label>
      <input type="number" step="0.5" min="0" max="${r.bareme}"
             class="input-note"
             data-reponse-id="${r.reponse_id}" data-bareme="${r.bareme}" />
    </div>
  `).join('');

  // Le numéro de copie est affiché à la place du nom du candidat -> c'est ça, l'anonymat des copies
  zone.innerHTML = `
    <div class="reponse-card-jury">
      <div class="copie-header">
        ${svgIcons.file} Copie #${indexCopieJury} <span class="copie-anon-tag">${svgIcons.shield} anonyme</span>
      </div>
      ${questionsHtml}
      <button class="btn-valider-copie" onclick="validerCopieJury('${copie.candidature_id}')">
        ${svgIcons.check} Valider la correction de cette copie
      </button>
    </div>
  `;
}

// ===== Validation de toute une copie en un seul clic =====
async function validerCopieJury(candidature_id) {
  const inputs = document.querySelectorAll('#zoneReponsesJury input[data-reponse-id]');
  const notes = [];

  // On vérifie chaque note avant d'envoyer quoi que ce soit
  for (const input of inputs) {
    const reponse_id = input.dataset.reponseId;
    const bareme = parseFloat(input.dataset.bareme);
    const points_obtenus = parseFloat(input.value);

    if (isNaN(points_obtenus) || points_obtenus < 0 || points_obtenus > bareme) {
      showAlertJury(`Chaque note doit être remplie et comprise entre 0 et son barème.`);
      return;
    }
    notes.push({ reponse_id, points_obtenus });
  }

  const confirmation = confirm(
    `Attention : une fois validée, la correction de cette copie ne pourra plus être modifiée.\n\nConfirmer la validation de cette copie complète ?`
  );
  if (!confirmation) return;

  // On envoie chaque note une par une (une requête par question)
  for (const note of notes) {
    const res = await fetch(`${API}/resultats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(note)
    });
    const data = await res.json();

    if (!res.ok) {
      showAlertJury(data.message || 'Erreur lors de l\'enregistrement d\'une note.');
      return;
    }
  }

  showAlertJury('Copie corrigée avec succès', 'success');

  // On retire la copie qui vient d'être traitée, et la suivante s'affiche automatiquement
  copiesJury.shift();
  afficherCopieCourante();
}

// ===== Initialisation au chargement de la page =====
chargerAffectationsJury();
chargerCandidaturesJury();
chargerConcoursJury();