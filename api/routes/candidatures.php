<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Postuler à un concours
if ($method === 'POST') {
    $user = verifierToken();

    // On vérifie que le concours_id est bien fourni avant d'aller plus loin
    if (empty($data['concours_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // Vérifier si déjà candidat à ce concours (on ne peut pas postuler deux fois)
    $check = $conn->prepare("SELECT id FROM candidatures 
        WHERE user_id = ? AND concours_id = ?");
    $check->execute([$user->id, $data['concours_id']]);
    
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Vous avez déjà postulé à ce concours"]);
        exit();
    }

    $stmt = $conn->prepare("INSERT INTO candidatures 
        (user_id, concours_id, statut) 
        VALUES (?, ?, 'en_attente')");
    
    $stmt->execute([$user->id, $data['concours_id']]);

    $candidature_id = $conn->lastInsertId();

    echo json_encode(["message" => "Candidature envoyée ✅", "candidature_id" => $candidature_id]);
}

// GET ALL — Admin voit toutes les candidatures
elseif ($method === 'GET' && isset($_GET['all'])) {
    $user = verifierToken();
    
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT ca.id, ca.statut, ca.created_at,
        u.nom AS candidat_nom,
        c.titre AS concours_titre
        FROM candidatures ca
        JOIN users u ON ca.user_id = u.id
        JOIN concours c ON ca.concours_id = c.id
        ORDER BY ca.created_at DESC");

    $stmt->execute();
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// GET — Voir ses propres candidatures (candidat connecté)
elseif ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT ca.id, c.titre, c.date_debut, c.date_fin, 
        ca.statut, ca.created_at 
        FROM candidatures ca
        JOIN concours c ON ca.concours_id = c.id
        WHERE ca.user_id = ?");
    
    $stmt->execute([$user->id]);
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// PUT — Admin valide ou refuse une candidature
elseif ($method === 'PUT') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    // On vérifie que le statut envoyé fait bien partie des valeurs autorisées
    // (évite qu'une valeur invalide se retrouve en base, ex: faute de frappe côté front)
    $statutsValides = ['en_attente', 'validé', 'rejeté'];
    if (empty($data['id']) || empty($data['statut']) || !in_array($data['statut'], $statutsValides)) {
        http_response_code(400);
        echo json_encode(["message" => "id ou statut invalide"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("UPDATE candidatures SET statut = ? WHERE id = ?");
    $stmt->execute([$data['statut'], $data['id']]);

    echo json_encode(["message" => "Statut mis à jour ✅"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}