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
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Réservé au l'administrateur"]);
        exit();
    }

    // Vérification des champs obligatoires (évite un plantage PHP brut si un champ manque)
    if (empty($_POST['epreuve_id']) || empty($_POST['enonce']) || empty($_POST['type']) || !isset($_POST['points']) || !isset($_POST['ordre'])) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id, enonce, type, points et ordre sont obligatoires"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Récupérer les données (FormData au lieu de JSON, car il peut y avoir un fichier joint)
    $epreuve_id = $_POST['epreuve_id'];
    $enonce     = $_POST['enonce'];
    $type       = $_POST['type'];
    $points     = $_POST['points'];
    $ordre      = $_POST['ordre'];
    $choix      = json_decode($_POST['choix'] ?? '[]', true);
    $media      = null;

    // Si un fichier est joint (étude de cas)
    if (isset($_FILES['media']) && $_FILES['media']['error'] === 0) {
        $fichier = $_FILES['media'];

        // Correction sécurité : comme pour documents.php, on ne fait pas confiance au nom
        // de fichier envoyé. On vérifie le VRAI type MIME et on choisit l'extension nous-même.
        $mimeAutorises = [
            'application/pdf' => 'pdf',
            'image/jpeg'       => 'jpg',
            'image/png'        => 'png',
        ];

        $mimeType = mime_content_type($fichier['tmp_name']);

        if (!isset($mimeAutorises[$mimeType])) {
            http_response_code(400);
            echo json_encode(["message" => "Format non autorisé (PDF, JPG, PNG uniquement)"]);
            exit();
        }

        $extension = $mimeAutorises[$mimeType];
        $nomFichier = uniqid('media_') . '.' . $extension;
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

    // Insérer les choix si présents (cas QCM/QRM)
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

    // JSON_ARRAYAGG regroupe tous les choix d'une question dans un seul tableau JSON
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
    $questions = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Sécurité : on masque les bonnes réponses si c'est un candidat qui consulte
    // (le jury et l'admin, eux, ont besoin de voir les bonnes réponses)
    if ($user->role === 'candidat') {
        foreach ($questions as &$q) {
            $choix = json_decode($q['choix'], true);
            if (is_array($choix)) {
                foreach ($choix as &$c) {
                    unset($c['est_correcte']);
                }
                unset($c);
                $q['choix'] = json_encode($choix);
            }
        }
        unset($q);
    }

    echo json_encode($questions);
}

// =====================
// DELETE — Supprimer une question + réordonner
// =====================
elseif ($method === 'DELETE') {
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Réservé à l'administrateur"]);
        exit();
    }

    $question_id = $data['id'] ?? null;
    if (!$question_id) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Récupérer l'épreuve liée pour vérifier le verrou temporel
    $stmt = $conn->prepare("
        SELECT e.id AS epreuve_id, e.date_epreuve
        FROM questions q
        JOIN epreuves e ON e.id = q.epreuve_id
        WHERE q.id = ?
    ");
    $stmt->execute([$question_id]);
    $epreuve = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$epreuve) {
        http_response_code(404);
        echo json_encode(["message" => "Question introuvable"]);
        exit();
    }

    // Verrou temporel : interdiction si l'épreuve a déjà commencé (protège l'intégrité de l'examen en cours)
    if (strtotime($epreuve['date_epreuve']) <= time()) {
        http_response_code(403);
        echo json_encode(["message" => "Modification impossible : l'épreuve a déjà débuté ou est terminée"]);
        exit();
    }

    // Suppression (choix_reponses puis question, dans cet ordre à cause de la clé étrangère)
    $conn->prepare("DELETE FROM choix_reponses WHERE question_id = ?")->execute([$question_id]);
    $conn->prepare("DELETE FROM questions WHERE id = ?")->execute([$question_id]);

    // Réordonnancement des questions restantes (pour ne pas laisser de trou dans la numérotation)
    $stmt = $conn->prepare("SELECT id FROM questions WHERE epreuve_id = ? ORDER BY ordre");
    $stmt->execute([$epreuve['epreuve_id']]);
    $restantes = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $update = $conn->prepare("UPDATE questions SET ordre = ? WHERE id = ?");
    $nouvelOrdre = 1;
    foreach ($restantes as $qid) {
        $update->execute([$nouvelOrdre, $qid]);
        $nouvelOrdre++;
    }

    echo json_encode(["message" => "Question supprimée et ordre mis à jour ✅"]);
}

else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}