<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

if ($method === 'POST') {
    if (!in_array($user->role, ['admin', 'jury'])) {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }
    $conn = (new Database())->connect();
    $stmt = $conn->prepare("INSERT INTO epreuves (concours_id, titre, type, duree, date_epreuve, statut) VALUES (?, ?, ?, ?, ?, 'planifiée')");
    $stmt->execute([$data['concours_id'], $data['titre'], $data['type'], $data['duree'], $data['date_epreuve']]);
    echo json_encode(["message" => "Épreuve créée ✅", "id" => $conn->lastInsertId()]);

} elseif ($method === 'GET') {
    $conn = (new Database())->connect();
    $concours_id = $_GET['concours_id'] ?? null;
    $en_attente = $_GET['en_attente'] ?? null;
    $mes_epreuves = $_GET['mes_epreuves'] ?? null;

    if ($mes_epreuves) {
    $sql = "SELECT e.*, c.titre AS concours_titre, cd.id AS candidature_id, (e.date_epreuve <= NOW()) AS est_accessible,
        EXISTS (SELECT 1 FROM reponses r WHERE r.candidature_id = cd.id) AS deja_soumise,
        EXISTS (SELECT 1 FROM exclusions ex WHERE ex.candidature_id = cd.id AND ex.epreuve_id = e.id) AS est_exclu
        FROM epreuves e
        JOIN concours c ON c.id = e.concours_id
        JOIN candidatures cd ON cd.concours_id = e.concours_id
        WHERE cd.user_id = ?
        AND cd.statut = 'validé'
        AND e.statut_validation = 'approuvé'
        ORDER BY e.date_epreuve";

    // Nettoyage : remplace les espaces invisibles par de vrais espaces
    $sql = str_replace("\xC2\xA0", " ", $sql);
    $sql = preg_replace('/\s+/', ' ', $sql);

    $stmt = $conn->prepare($sql);
    $stmt->execute([$user->id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    exit();
}

    if ($en_attente) {
        $stmt = $conn->prepare("SELECT e.*, c.titre AS concours_titre FROM epreuves e JOIN concours c ON c.id = e.concours_id WHERE e.statut_validation = 'en_attente' ORDER BY e.id DESC");
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
        exit();
    }

    if (!$concours_id) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    $stmt = $conn->prepare("SELECT * FROM epreuves WHERE concours_id = ? ORDER BY date_epreuve");
    $stmt->execute([$concours_id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

} elseif ($method === 'PUT') {
    $conn = (new Database())->connect();
    $epreuve_id = $data['id'] ?? null;

    if (!$epreuve_id || !is_numeric($epreuve_id)) {
        http_response_code(400);
        echo json_encode(["message" => "ID épreuve manquant ou invalide"]);
        exit();
    }

    if (in_array($user->role, ['jury', 'admin']) && isset($data['statut_validation'])) {
        $stmt = $conn->prepare("UPDATE epreuves SET statut_validation = ? WHERE id = ?");
        $stmt->execute([$data['statut_validation'], $epreuve_id]);
        echo json_encode(["message" => "Épreuve " . $data['statut_validation'] . " ✅"]);
        exit();
    }

    http_response_code(403);
    echo json_encode(["message" => "Accès refusé"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}