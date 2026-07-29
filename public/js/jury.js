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

function showAlertJury(msg, type = 'danger') {
  document.getElementById('alertMsgJury').innerHTML =
    `<div class="alert alert-${type}">${msg}</div>`;
}

// Petite protection contre l'injection HTML dans les noms/titres affichés
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ============================================
// ===== Candidatures à examiner (nouveau) =====
// ============================================

// Traduit la valeur technique de l'avis en badge lisible pour le jury
function badgeAvis(avis) {
  if (avis === 'favorable') return '<span class="badge bg-success">Favorable</span>';
  if (avis === 'defavorable') return '<span class="badge bg-danger">Défavorable</span>';
  return '<span class="badge bg-secondary">En attente</span>';
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
             target="_blank" class="btn btn-sm btn-outline-primary">👁️ Voir dossier</a>
          <button class="btn btn-sm btn-success" onclick="donnerAvisCandidature(${c.id}, 'favorable')">✅ Favorable</button>
          <button class="btn btn-sm btn-danger" onclick="donnerAvisCandidature(${c.id}, 'defavorable')">❌ Défavorable</button>
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

// ===== Chargement des concours =====
async function chargerConcoursJury() {
  const res = await fetch(`${API}/concours`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();

  const select = document.getElementById('selectConcoursJury');
  select.innerHTML = '<option value="">-- Choisir un concours --</option>';
  data.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.titre}</option>`;
  });
}

// ===== Chargement des épreuves approuvées du concours choisi =====
async function chargerEpreuvesJury() {
  const concours_id = document.getElementById('selectConcoursJury').value;
  const selectEpreuve = document.getElementById('selectEpreuveJury');
  document.getElementById('zoneReponsesJury').innerHTML = '';

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
    selectEpreuve.innerHTML += `<option value="${e.id}">${e.titre} (coeff. ${e.coefficient})</option>`;
  });
}

// ===== Gestion des copies (regroupement par candidature) =====
let copiesJury = [];      // liste des copies restantes à corriger
let indexCopieJury = 0;   // compteur pour afficher "Copie #1", "Copie #2", etc.

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

  afficherCopieCourante();
}

// ===== Affiche une seule copie à la fois (jamais toutes en même temps) =====
// Ça évite au correcteur de se mélanger entre plusieurs copies ouvertes en même temps
function afficherCopieCourante() {
  const zone = document.getElementById('zoneReponsesJury');

  if (copiesJury.length === 0) {
    zone.innerHTML = `<div class="alert alert-info">Toutes les copies de cette épreuve sont corrigées ✅</div>`;
    return;
  }

  const copie = copiesJury[0]; // on prend toujours la première copie restante dans la liste
  indexCopieJury++;

  const questionsHtml = copie.reponses.map(r => `
    <div class="mb-4">
      <p class="fw-semibold mb-1">Question :</p>
      <p class="mb-2">${r.enonce}</p>
      <p class="fw-semibold mb-1">Réponse du candidat :</p>
      <p class="mb-2 text-muted">${r.texte_reponse}</p>
      <label class="form-label fw-semibold">Note (sur ${r.bareme})</label>
      <input type="number" step="0.5" min="0" max="${r.bareme}"
             class="form-control" style="max-width:150px"
             data-reponse-id="${r.reponse_id}" data-bareme="${r.bareme}" />
      <hr class="mt-4">
    </div>
  `).join('');

  // Le numéro de copie est affiché à la place du nom du candidat -> c'est ça, l'anonymat des copies
  zone.innerHTML = `
    <div class="card reponse-card p-4 mb-3">
      <h6 class="fw-bold mb-3">📄 Copie #${indexCopieJury} <span class="text-muted fw-normal">(anonyme)</span></h6>
      ${questionsHtml}
      <button class="btn btn-primary" onclick="validerCopieJury('${copie.candidature_id}')">
        ✅ Valider la correction de cette copie
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
    `⚠️ Attention : une fois validée, la correction de cette copie ne pourra plus être modifiée.\n\nConfirmer la validation de cette copie complète ?`
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

  showAlertJury('Copie corrigée avec succès ✅', 'success');

  // On retire la copie qui vient d'être traitée, et la suivante s'affiche automatiquement
  copiesJury.shift();
  afficherCopieCourante();
}

// ===== Initialisation au chargement de la page =====
chargerCandidaturesJury();
chargerConcoursJury();