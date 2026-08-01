<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Affecter un jury à un concours (réservé admin)
if ($method === 'POST') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
        exit();
    }

    if (empty($data['jury_id']) || empty($data['concours_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "jury_id et concours_id sont obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // On vérifie que le compte ciblé est bien un jury (évite d'affecter un admin ou un candidat par erreur)
    $checkRole = $conn->prepare("SELECT id FROM users WHERE id = ? AND role = 'jury'");
    $checkRole->execute([$data['jury_id']]);
    if (!$checkRole->fetch()) {
        http_response_code(400);
        echo json_encode(["message" => "L'utilisateur choisi n'est pas un compte jury"]);
        exit();
    }

    try {
        $stmt = $conn->prepare("INSERT INTO jury_affectations_concours (jury_id, concours_id) VALUES (?, ?)");
        $stmt->execute([$data['jury_id'], $data['concours_id']]);

        echo json_encode(["message" => "Jury affecté au concours ✅", "id" => $conn->lastInsertId()]);
    } catch (PDOException $e) {
        // Code 23000 = violation de contrainte (ici la contrainte UNIQUE(jury_id, concours_id))
        if ($e->getCode() == 23000) {
            http_response_code(409);
            echo json_encode(["message" => "Ce jury est déjà affecté à ce concours"]);
        } else {
            http_response_code(500);
            echo json_encode(["message" => "Erreur lors de l'affectation"]);
        }
    }
}

// DELETE — Retirer une affectation (réservé admin)
elseif ($method === 'DELETE') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
        exit();
    }

    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("DELETE FROM jury_affectations_concours WHERE id = ?");
    $stmt->execute([$data['id']]);

    echo json_encode(["message" => "Affectation retirée ✅"]);
}

// GET — Deux usages selon le rôle de l'appelant :
//   - admin + ?concours_id=X  -> liste des jurys affectés à ce concours (pour l'écran de gestion)
//   - jury (sans paramètre)   -> ses propres affectations (pour le bandeau dans jury.html)
elseif ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    if ($user->role === 'admin') {
        if (empty($_GET['concours_id'])) {
            http_response_code(400);
            echo json_encode(["message" => "concours_id manquant"]);
            exit();
        }

        $stmt = $conn->prepare("SELECT jac.id, jac.jury_id, u.nom AS jury_nom, u.email AS jury_email
            FROM jury_affectations_concours jac
            JOIN users u ON jac.jury_id = u.id
            WHERE jac.concours_id = ?
            ORDER BY u.nom ASC");
        $stmt->execute([$_GET['concours_id']]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

    } elseif ($user->role === 'jury') {
        // 🔒 L'id vient uniquement du token décodé, jamais d'un paramètre client :
        // un jury ne peut donc jamais consulter les affectations d'un autre jury
        $stmt = $conn->prepare("SELECT jac.concours_id, c.titre AS concours_titre
            FROM jury_affectations_concours jac
            JOIN concours c ON jac.concours_id = c.id
            WHERE jac.jury_id = ?
            ORDER BY c.titre ASC");
        $stmt->execute([$user->id]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

    } else {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
    }

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}