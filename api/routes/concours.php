<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// GET — Liste tous les concours
if ($method === 'GET') {
    $user = verifierToken();
    
    $db = new Database();
    $conn = $db->connect();
    
    $stmt = $conn->prepare("SELECT * FROM concours");
    $stmt->execute();
    $concours = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode($concours);
}

// POST — Créer un concours (admin seulement)
elseif ($method === 'POST') {
    $user = verifierToken();
    
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé, admin seulement"]);
        exit();
    }

    // Vérification des champs obligatoires avant d'aller plus loin
    if (empty($data['titre']) || empty($data['description']) || empty($data['date_debut']) || empty($data['date_fin'])) {
        http_response_code(400);
        echo json_encode(["message" => "Titre, description, date_debut et date_fin sont obligatoires"]);
        exit();
    }
    
    $db = new Database();
    $conn = $db->connect();
    
    $stmt = $conn->prepare("INSERT INTO concours 
        (titre, description, date_debut, date_fin, statut, nb_places) 
        VALUES (?, ?, ?, ?, ?, ?)");
    
    $stmt->execute([
        $data['titre'],
        $data['description'],
        $data['date_debut'],
        $data['date_fin'],
        $data['statut'] ?? 'ouvert',
        $data['nb_places'] ?? null
    ]);
    
    echo json_encode(["message" => "Concours créé ✅"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}