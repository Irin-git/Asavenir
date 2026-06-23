<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

// =====================
// POST — Créer une épreuve
// =====================
if ($method === 'POST') {
    if (!in_array($user->role, ['admin', 'jury'])) {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    $conn = (new Database())->connect();
    $stmt = $conn->prepare("
        INSERT INTO epreuves (concours_id, titre, type, duree, date_epreuve, statut)
        VALUES (?, ?, ?, ?, ?, 'planifiée')
    ");
    $stmt->execute([
        $data['concours_id'],
        $data['titre'],
        $data['type'],
        $data['duree'],
        $data['date_epreuve']
    ]);

    echo json_encode(["message" => "Épreuve créée ✅", "id" => $conn->lastInsertId()]);
}

// GET — Lister les épreuves d'un concours

elseif ($method === 'GET') {
    $conn = (new Database())->connect();
    $concours_id = $_GET['concours_id'] ?? null;

    if (!$concours_id) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    $stmt = $conn->prepare("SELECT * FROM epreuves WHERE concours_id = ? ORDER BY date_epreuve");
    $stmt->execute([$concours_id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
}

else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}