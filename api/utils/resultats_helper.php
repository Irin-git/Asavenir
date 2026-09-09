<?php
// =========================================================================
// CORRECTIF BUG : avant, le calcul du résultat n'était déclenché QUE quand
// le jury notait une question ouverte (routes/resultats.php). Un concours
// composé uniquement de QCM (corrigés automatiquement, sans intervention
// du jury) ne déclenchait donc jamais ce calcul -> aucun résultat, et le
// bouton "Publier les résultats" restait bloqué pour ce concours.
//
// Cette fonction est maintenant appelée à DEUX endroits :
//   1. reponses.php, juste après qu'un candidat soumette ses réponses QCM
//   2. resultats.php, juste après qu'un jury note une question ouverte
// Dans les deux cas, elle vérifie si la copie est complète et calcule le
// résultat si besoin -> plus aucune duplication de logique.
// =========================================================================

// Recalcule le rang et la mention de TOUS les candidats d'un concours.
// Appelée après chaque nouveau résultat calculé, car un nouveau résultat
// peut faire bouger le classement de tout le monde.
function recalculerClassement($conn, $concours_id) {
    $nbStmt = $conn->prepare("SELECT nb_places FROM concours WHERE id = ?");
    $nbStmt->execute([$concours_id]);
    $nb_places = $nbStmt->fetchColumn();

    $listStmt = $conn->prepare("
        SELECT r.id, r.note_totale
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
        ORDER BY r.note_totale DESC
    ");
    $listStmt->execute([$concours_id]);
    $liste = $listStmt->fetchAll(PDO::FETCH_ASSOC);

    $rang = 1;
    foreach ($liste as $ligne) {
        // Être dans le nombre de places disponibles prime sur la simple moyenne
        if ($nb_places !== null && $rang <= $nb_places) {
            $mention = 'Admis';
        } elseif ($ligne['note_totale'] >= 10) {
            $mention = 'Ajourné';
        } else {
            $mention = 'Rejeté';
        }

        $upd = $conn->prepare("UPDATE resultats SET rang = ?, mention = ? WHERE id = ?");
        $upd->execute([$rang, $mention, $ligne['id']]);
        $rang++;
    }
}

// Vérifie si TOUTES les réponses d'une candidature sont désormais notées
// (automatiquement pour un QCM via est_correcte, ou manuellement par le
// jury via points_obtenus) et calcule/publie le résultat si c'est le cas.
function verifierEtCalculerResultat($conn, $candidature_id) {
    $concoursStmt = $conn->prepare("SELECT concours_id FROM candidatures WHERE id = ?");
    $concoursStmt->execute([$candidature_id]);
    $concours_id = $concoursStmt->fetchColumn();
    if (!$concours_id) return;

    // Encore des réponses en attente de correction manuelle -> on ne calcule rien pour l'instant
    $check = $conn->prepare("
        SELECT COUNT(*) FROM reponses
        WHERE candidature_id = ? AND points_obtenus IS NULL AND est_correcte IS NULL
    ");
    $check->execute([$candidature_id]);
    if ($check->fetchColumn() > 0) return;

    // Note obtenue/possible PAR ÉPREUVE
    $parEpreuveStmt = $conn->prepare("
        SELECT
            e.id AS epreuve_id,
            e.coefficient,
            SUM(CASE
                    WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                    WHEN r.est_correcte = 1 THEN q.points
                    ELSE 0
                END) AS obtenu_epreuve,
            SUM(q.points) AS possible_epreuve
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        INNER JOIN epreuves e ON q.epreuve_id = e.id
        WHERE r.candidature_id = ?
        GROUP BY e.id, e.coefficient
    ");
    $parEpreuveStmt->execute([$candidature_id]);
    $epreuvesData = $parEpreuveStmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($epreuvesData)) return; // rien à calculer (candidature sans aucune réponse)

    // Moyenne pondérée par coefficient, sur 20
    $somme_ponderee = 0;
    $somme_coefficients = 0;

    foreach ($epreuvesData as $ep) {
        $note_epreuve_sur_20 = $ep['possible_epreuve'] > 0
            ? ($ep['obtenu_epreuve'] / $ep['possible_epreuve']) * 20
            : 0;

        $somme_ponderee += $note_epreuve_sur_20 * $ep['coefficient'];
        $somme_coefficients += $ep['coefficient'];
    }

    $note_totale = $somme_coefficients > 0 ? round($somme_ponderee / $somme_coefficients, 2) : 0;

    $upsert = $conn->prepare("
        INSERT INTO resultats (candidature_id, note_totale, date_publication)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE note_totale = VALUES(note_totale), date_publication = NOW()
    ");
    $upsert->execute([$candidature_id, $note_totale]);

    recalculerClassement($conn, $concours_id);
}