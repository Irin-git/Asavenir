<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

// Upload des documents d'une candidature

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = verifierToken(); // candidat connecté

    $db = new Database();
    $conn = $db->connect();

    $candidature_id = $_POST['candidature_id'] ?? null;
    if (!$candidature_id) {
        http_response_code(400);
        echo json_encode(['message' => 'candidature_id manquant']);
        exit;
    }

    // Vérifier que cette candidature appartient bien à ce candidat
    $stmt = $conn->prepare("SELECT id FROM candidatures WHERE id = ? AND user_id = ?");
    $stmt->execute([$candidature_id, $user->id]);
    if (!$stmt->fetch()) {
        http_response_code(403);
        echo json_encode(['message' => 'Candidature non autorisée']);
        exit;
    }

    // Définir les types acceptés
    $typesAcceptes = [
        'cin'      => ['application/pdf', 'image/jpeg', 'image/png'],
        'photo'    => ['image/jpeg', 'image/png'],
        'cv'       => ['application/pdf'],
        'diplome'  => ['application/pdf'],
        'acte'     => ['application/pdf'],
    ];

    $dossierBase = __DIR__ . '/../../uploads/';
    $dossiers = [
        'cin'     => $dossierBase . 'cin/',
        'photo'   => $dossierBase . 'photos/',
        'cv'      => $dossierBase . 'cv/',
        'diplome' => $dossierBase . 'diplomes/',
        'acte'    => $dossierBase . 'actes/',
    ];

    $uploadOk = [];
    $erreurs = [];

    foreach ($typesAcceptes as $type => $formatsOk) {
        if (!isset($_FILES[$type]) || $_FILES[$type]['error'] === 4 || empty($_FILES[$type]['tmp_name'])) {
    $erreurs[] = "$type manquant";
    continue;
}

        $fichier = $_FILES[$type];
        $mimeType = mime_content_type($fichier['tmp_name']);
        
        if (!in_array($mimeType, $formatsOk)) {
            $erreurs[] = "Format invalide pour $type";
            continue;
        }

        if ($fichier['size'] > 2 * 1024 * 1024) {
            $erreurs[] = "$type dépasse 2MB";
            continue;
        }

        $extension = pathinfo($fichier['name'], PATHINFO_EXTENSION);
        $nomFichier = $type . '_' . $candidature_id . '_' . time() . '.' . $extension;
        $destination = $dossiers[$type] . $nomFichier;

        if (move_uploaded_file($fichier['tmp_name'], $destination)) {
            $chemin = 'uploads/' . basename($dossiers[$type]) . '/' . $nomFichier;
            $stmt = $conn->prepare("
                INSERT INTO documents (candidature_id, type, nom_fichier, chemin)
                VALUES (?, ?, ?, ?)
            ");
            $stmt->execute([$candidature_id, $type, $nomFichier, $chemin]);
            $uploadOk[] = $type;
        } else {
            $erreurs[] = "Échec upload $type";
        }
    }

    if (count($erreurs) > 0) {
        http_response_code(400);
        echo json_encode(['message' => 'Certains fichiers ont échoué', 'erreurs' => $erreurs, 'succes' => $uploadOk]);
    } else {
        echo json_encode(['message' => 'Tous les documents uploadés avec succès', 'succes' => $uploadOk]);
    }
}

// GET — Récupérer les documents d'une candidature (admin)
elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(['message' => 'Réservé à l\'admin']);
        exit;
    }

    $candidature_id = $_GET['candidature_id'] ?? null;
    if (!$candidature_id) {
        http_response_code(400);
        echo json_encode(['message' => 'candidature_id manquant']);
        exit;
    }

    $conn = (new Database())->connect();
    $stmt = $conn->prepare("SELECT * FROM documents WHERE candidature_id = ?");
    $stmt->execute([$candidature_id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
}