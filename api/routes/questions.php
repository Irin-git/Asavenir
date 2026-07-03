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

    // Récupérer les données (FormData au lieu de JSON)
    $epreuve_id = $_POST['epreuve_id'];
    $enonce     = $_POST['enonce'];
    $type       = $_POST['type'];
    $points     = $_POST['points'];
    $ordre      = $_POST['ordre'];
    $choix      = json_decode($_POST['choix'] ?? '[]', true);
    $media      = null;

    // Si un fichier est joint (étude de cas)
    if (isset($_FILES['media']) && $_FILES['media']['error'] === 0) {
        $fichier    = $_FILES['media'];
        $ext        = strtolower(pathinfo($fichier['name'], PATHINFO_EXTENSION));
        $autorise   = ['pdf', 'jpg', 'jpeg', 'png'];

        if (!in_array($ext, $autorise)) {
            http_response_code(400);
            echo json_encode(["message" => "Format non autorisé (PDF, JPG, PNG uniquement)"]);
            exit();
        }

        $nomFichier = uniqid('media_') . '.' . $ext;
        $destination = __DIR__ . '/../../uploads/medias/' . $nomFichier;

        if (!move_uploaded_file($fichier['tmp_name'], $destination)) {
            http_response_code(500);
            echo json_encode(["message" => "Échec de l'upload du fichier"]);
            exit();
        }

        $media = $nomFichier; // on stocke juste le nom en base
    }

    // Insérer la question
    $stmt = $conn->prepare("
        INSERT INTO questions (epreuve_id, enonce, media, type, points, ordre)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$epreuve_id, $enonce, $media, $type, $points, $ordre]);
    $question_id = $conn->lastInsertId();

    // Insérer les choix si présents
    if (!empty($choix)) {
        $stmtChoix = $conn->prepare("
            INSERT INTO choix_reponses (question_id, texte, est_correcte)
            VALUES (?, ?, ?)
        ");
        foreach ($choix as $c) {
            $stmtChoix->execute([$question_id, $c['texte'], $c['est_correcte'] ? 1 : 0]);
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