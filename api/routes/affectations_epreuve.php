<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

// Sur le même modèle que affectations.php (concours), mais pour la granularité épreuve.
// Sert au cloisonnement de la CORRECTION DES COPIES (jury_affectations_epreuve),
// à ne pas confondre avec jury_affectations_concours (examen des dossiers).

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Affecter un jury à une épreuve précise (réservé admin)
if ($method === 'POST') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
        exit();
    }

    if (empty($data['jury_id']) || empty($data['epreuve_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "jury_id et epreuve_id sont obligatoires"]);
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
        $stmt = $conn->prepare("INSERT INTO jury_affectations_epreuve (jury_id, epreuve_id) VALUES (?, ?)");
        $stmt->execute([$data['jury_id'], $data['epreuve_id']]);

        echo json_encode(["message" => "Jury affecté à l'épreuve ✅", "id" => $conn->lastInsertId()]);
    } catch (PDOException $e) {
        // Code 23000 = violation de contrainte (ici la contrainte UNIQUE(jury_id, epreuve_id))
        if ($e->getCode() == 23000) {
            http_response_code(409);
            echo json_encode(["message" => "Ce jury est déjà affecté à cette épreuve"]);
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

    $stmt = $conn->prepare("DELETE FROM jury_affectations_epreuve WHERE id = ?");
    $stmt->execute([$data['id']]);

    echo json_encode(["message" => "Affectation retirée ✅"]);
}

// GET — Deux usages selon le rôle de l'appelant :
//   - admin + ?epreuve_id=X -> liste des jurys affectés à cette épreuve (pour l'écran de gestion)
//   - jury (sans paramètre)  -> ses propres affectations épreuve (usage futur possible)
elseif ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    if ($user->role === 'admin') {
        if (empty($_GET['epreuve_id'])) {
            http_response_code(400);
            echo json_encode(["message" => "epreuve_id manquant"]);
            exit();
        }

        $stmt = $conn->prepare("SELECT jae.id, jae.jury_id, u.nom AS jury_nom, u.email AS jury_email
            FROM jury_affectations_epreuve jae
            JOIN users u ON jae.jury_id = u.id
            WHERE jae.epreuve_id = ?
            ORDER BY u.nom ASC");
        $stmt->execute([$_GET['epreuve_id']]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

    } elseif ($user->role === 'jury') {
        // 🔒 L'id vient uniquement du token décodé, jamais d'un paramètre client
        $stmt = $conn->prepare("SELECT jae.epreuve_id, e.titre AS epreuve_titre
            FROM jury_affectations_epreuve jae
            JOIN epreuves e ON jae.epreuve_id = e.id
            WHERE jae.jury_id = ?
            ORDER BY e.titre ASC");
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