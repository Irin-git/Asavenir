<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../utils/notifier.php';

header('Content-Type: application/json');

// 🔒 Pas de JWT ici : ce script est appelé par une tâche planifiée externe (GitHub Actions),
// pas par un utilisateur connecté dans son navigateur. On protège donc avec une clé secrète.
$cronConfig = require __DIR__ . '/../config/cron.php';

if (($_GET['cle'] ?? '') !== $cronConfig['secret']) {
    http_response_code(403);
    echo json_encode(["message" => "Accès refusé"]);
    exit();
}

$conn = (new Database())->connect();

// Épreuves qui débutent dans les prochaines 24h et pour lesquelles le rappel n'a pas encore été envoyé
$stmt = $conn->prepare("
    SELECT e.id, e.titre, e.date_epreuve, e.concours_id, c.titre AS concours_titre
    FROM epreuves e
    JOIN concours c ON c.id = e.concours_id
    WHERE e.rappel_envoye = 0
    AND e.date_epreuve BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
");
$stmt->execute();
$epreuves = $stmt->fetchAll(PDO::FETCH_ASSOC);

$totalNotifies = 0;

foreach ($epreuves as $epreuve) {
    // Candidats validés ET à jour de paiement pour le concours de cette épreuve = ceux qui doivent la passer
    // (Chantier 5) On récupère aussi leur salle assignée si la répartition a déjà été faite
    $stmtCandidats = $conn->prepare("
        SELECT ca.id AS candidature_id, ca.user_id, se.nom_salle
        FROM candidatures ca
        LEFT JOIN affectations_salle aff ON aff.candidature_id = ca.id AND aff.epreuve_id = ?
        LEFT JOIN salles_epreuve se ON se.id = aff.salle_id
        WHERE ca.concours_id = ? AND ca.statut = 'validé' AND ca.paiement_effectue = 1
    ");
    $stmtCandidats->execute([$epreuve['id'], $epreuve['concours_id']]);
    $candidats = $stmtCandidats->fetchAll(PDO::FETCH_ASSOC);

    $dateFormatee = date('d/m/Y à H:i', strtotime($epreuve['date_epreuve']));

    foreach ($candidats as $candidat) {
        $mentionSalle = $candidat['nom_salle'] ? " en salle {$candidat['nom_salle']}" : "";
        creerNotification(
            $conn,
            $candidat['user_id'],
            "Rappel : épreuve à venir",
            "Votre épreuve \"{$epreuve['titre']}\" ({$epreuve['concours_titre']}) débute le $dateFormatee$mentionSalle.",
            'rappel',
            '/concours_fp/public/epreuves.html'
        );
        $totalNotifies++;
    }

    // On marque l'épreuve pour ne jamais renvoyer deux fois le même rappel
    $marquer = $conn->prepare("UPDATE epreuves SET rappel_envoye = 1 WHERE id = ?");
    $marquer->execute([$epreuve['id']]);
}

echo json_encode([
    "message" => "Rappels traités",
    "epreuves_traitees" => count($epreuves),
    "notifications_envoyees" => $totalNotifies
]);
