<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

if ($user->role !== 'admin') {
    http_response_code(403);
    echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
    exit();
}

$conn = (new Database())->connect();

// GET — Liste des salles d'une épreuve, avec le nombre de candidats déjà affectés à chacune
if ($method === 'GET') {
    if (empty($_GET['epreuve_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id manquant"]);
        exit();
    }

    $stmt = $conn->prepare("
        SELECT se.*,
            (SELECT COUNT(*) FROM affectations_salle aff WHERE aff.salle_id = se.id) AS nb_affectes
        FROM salles_epreuve se
        WHERE se.epreuve_id = ?
        ORDER BY se.id
    ");
    $stmt->execute([$_GET['epreuve_id']]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

// POST — Ajouter une salle à une épreuve existante
} elseif ($method === 'POST') {
    if (empty($data['epreuve_id']) || empty($data['nom_salle'])) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id et nom_salle sont obligatoires"]);
        exit();
    }

    $stmt = $conn->prepare("INSERT INTO salles_epreuve (epreuve_id, nom_salle, capacite) VALUES (?, ?, ?)");
    $stmt->execute([$data['epreuve_id'], $data['nom_salle'], $data['capacite'] ?: null]);

    echo json_encode(["message" => "Salle ajoutée ✅", "id" => $conn->lastInsertId()]);

// DELETE — Retirer une salle (les candidats qui y étaient affectés redeviennent "non affectés")
} elseif ($method === 'DELETE') {
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    // ON DELETE CASCADE sur affectations_salle : les affectations liées à cette salle sont
    // automatiquement supprimées, pas besoin de le faire à la main ici
    $stmt = $conn->prepare("DELETE FROM salles_epreuve WHERE id = ?");
    $stmt->execute([$data['id']]);

    echo json_encode(["message" => "Salle supprimée ✅"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}
