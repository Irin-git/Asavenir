<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

// =====================
// POST — Créer une question
// =====================
if ($method === 'POST') {
    if ($user->role !== 'jury') {
        http_response_code(403);
        echo json_encode(["message" => "Réservé au jury"]);
        exit();
    }

    $conn = (new Database())->connect();

    // 1. Insérer la question
    $stmt = $conn->prepare("
        INSERT INTO questions (epreuve_id, enonce, media, type, points, ordre)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $data['epreuve_id'],
        $data['enonce'],
        $data['media'] ?? null,
        $data['type'],
        $data['points'],
        $data['ordre']
    ]);

    $question_id = $conn->lastInsertId();

    // 2. Insérer les choix de réponses si present
    if (!empty($data['choix'])) {
        $stmtChoix = $conn->prepare("
            INSERT INTO choix_reponses (question_id, texte, est_correcte)
            VALUES (?, ?, ?)
        ");
        foreach ($data['choix'] as $choix) {
            $stmtChoix->execute([
                $question_id,
                $choix['texte'],
                $choix['est_correcte'] ? 1 : 0
            ]);
        }
    }

    echo json_encode(["message" => "Question créée ✅", "id" => $question_id]);
}

// =====================
// GET — Lister les questions d'une épreuve
// =====================
elseif ($method === 'GET') {
    $conn = (new Database())->connect();
    $epreuve_id = $_GET['epreuve_id'] ?? null;

    if (!$epreuve_id) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id manquant"]);
        exit();
    }

    $stmt = $conn->prepare("
        SELECT q.*, 
               JSON_ARRAYAGG(
                   JSON_OBJECT('id', c.id, 'texte', c.texte, 'est_correcte', c.est_correcte)
               ) as choix
        FROM questions q
        LEFT JOIN choix_reponses c ON c.question_id = q.id
        WHERE q.epreuve_id = ?
        GROUP BY q.id
        ORDER BY q.ordre
    ");
    $stmt->execute([$epreuve_id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
}

else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}