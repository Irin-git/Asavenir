<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$user = verifierToken();

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
    exit();
}

$conn = (new Database())->connect();

// Infos du candidat, pour l'en-tête du document de convocation
$stmtUser = $conn->prepare("SELECT nom, email FROM users WHERE id = ?");
$stmtUser->execute([$user->id]);
$candidat = $stmtUser->fetch(PDO::FETCH_ASSOC);

// Toutes les épreuves auxquelles ce candidat est convoqué (candidature validée + paiement confirmé),
// avec sa salle assignée si la répartition a déjà été faite par l'admin
$stmt = $conn->prepare("
    SELECT e.titre, e.type, e.duree, e.date_epreuve, c.titre AS concours_titre, se.nom_salle AS ma_salle
    FROM epreuves e
    JOIN concours c ON c.id = e.concours_id
    JOIN candidatures cd ON cd.concours_id = e.concours_id
    LEFT JOIN affectations_salle aff ON aff.epreuve_id = e.id AND aff.candidature_id = cd.id
    LEFT JOIN salles_epreuve se ON se.id = aff.salle_id
    WHERE cd.user_id = ?
    AND cd.statut = 'validé'
    AND cd.paiement_effectue = 1
    ORDER BY e.date_epreuve ASC
");
$stmt->execute([$user->id]);
$epreuves = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode([
    "candidat" => $candidat,
    "epreuves" => $epreuves
]);
